//! Download progress for the model installer, measured on disk.
//!
//! The installer runs with `HF_HUB_DISABLE_PROGRESS_BARS=1` and announces
//! each source it fetches (`hub.Repository.download`):
//!
//! ```text
//! Fetching 3 file(s), 16.82 GB, from unsloth/Qwen3.8-27B-GGUF@4ca720788d1e; cached files are reused.
//! ```
//!
//! Each announcement starts a segment. Its progress is the bytes, in that
//! repository's `blobs/`, of every blob that was not complete when the
//! segment started: the finished blob's size, or else its largest
//! `<blob>.<suffix>.incomplete` partial. A partial left by an earlier,
//! interrupted download counts at once (huggingface_hub resumes it), and a
//! blob renamed on completion counts once.

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::hfcache;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DownloadPhase {
    /// Waiting for another installation (models/.install.lock).
    Queued,
    /// device-check, resolving the repository, reading headers.
    Checking,
    Downloading,
    /// Converting, assembling and verifying after the download.
    Preparing,
    Done,
    Failed,
    Cancelled,
}

/// `Fetching N file(s), X GB, from REPO@REV; ...`
#[derive(Debug, Clone, PartialEq)]
pub struct FetchAnnouncement {
    pub files: u32,
    pub bytes: u64,
    pub repo: String,
    pub revision: String,
}

pub fn parse_fetch_line(line: &str) -> Option<FetchAnnouncement> {
    let rest = line.trim().strip_prefix("Fetching ")?;
    let (files, rest) = rest.split_once(" file(s), ")?;
    let (gb, rest) = rest.split_once(" GB, from ")?;
    let target = rest.split(';').next()?.trim().trim_end_matches('.');
    let (repo, revision) = target.split_once('@')?;
    let gb: f64 = gb.trim().parse().ok()?;
    if !gb.is_finite() || gb < 0.0 {
        return None;
    }
    Some(FetchAnnouncement {
        files: files.trim().parse().ok()?,
        bytes: (gb * 1e9).round() as u64,
        repo: repo.to_string(),
        revision: revision.to_string(),
    })
}

/// The phase an installer output line moves to.
pub fn phase_for_line(current: DownloadPhase, line: &str) -> DownloadPhase {
    let line = line.trim();
    if line.starts_with("Another Splash model installation is running") {
        DownloadPhase::Queued
    } else if parse_fetch_line(line).is_some() {
        DownloadPhase::Downloading
    } else if line.starts_with("Warning:") || line.is_empty() {
        current
    } else if current == DownloadPhase::Downloading || current == DownloadPhase::Queued {
        // The installer is silent while it downloads; the next line means
        // the fetch finished (or it moved on to checks).
        if current == DownloadPhase::Queued {
            DownloadPhase::Checking
        } else {
            DownloadPhase::Preparing
        }
    } else {
        current
    }
}

/// Bytes on disk of the blobs not in `baseline` (see the module docs).
pub fn segment_bytes(blobs_dir: &Path, baseline: &HashSet<String>) -> u64 {
    let blobs = hfcache::scan_blobs(blobs_dir);
    let complete: u64 = blobs
        .complete
        .iter()
        .filter(|(id, _)| !baseline.contains(*id))
        .map(|(_, size)| size)
        .sum();
    let partial: u64 = blobs
        .partial
        .iter()
        .filter(|(id, _)| !baseline.contains(*id) && !blobs.complete.contains_key(*id))
        .map(|(_, size)| size)
        .sum();
    complete + partial
}

/// Speed over a sliding window of samples.
#[derive(Debug, Default)]
pub struct SpeedMeter {
    samples: VecDeque<(u64, u64)>,
}

impl SpeedMeter {
    const WINDOW_MS: u64 = 8_000;

    pub fn sample(&mut self, at_ms: u64, bytes: u64) {
        if self.samples.back().is_some_and(|(_, b)| bytes < *b) {
            // A new segment (or a deleted partial): start over.
            self.samples.clear();
        }
        self.samples.push_back((at_ms, bytes));
        while self.samples.len() > 2
            && self
                .samples
                .front()
                .is_some_and(|(t, _)| at_ms.saturating_sub(*t) > Self::WINDOW_MS)
        {
            self.samples.pop_front();
        }
    }

    /// Bytes per second; 0 until two samples span time.
    pub fn rate(&self) -> f64 {
        match (self.samples.front(), self.samples.back()) {
            (Some((t0, b0)), Some((t1, b1))) if t1 > t0 => {
                (b1 - b0) as f64 * 1000.0 / (t1 - t0) as f64
            }
            _ => 0.0,
        }
    }

    pub fn reset(&mut self) {
        self.samples.clear();
    }
}

/// Payload of `models://progress`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelProgress {
    /// The model as requested (OWNER/REPO[:VARIANT]).
    pub model: String,
    /// The job key: the selection link relative to the models folder.
    pub key: String,
    /// The repository being fetched now (target, then draft).
    pub repo: Option<String>,
    pub bytes_done: u64,
    pub bytes_total: u64,
    /// Bytes per second.
    pub speed: f64,
    /// Seconds left, when the speed is known.
    pub eta: Option<f64>,
    pub phase: DownloadPhase,
    /// 1-based fetch number (a target and its draft are two).
    pub segment: u32,
    pub files: u32,
    /// Bytes of finished segments plus this one.
    pub overall_done: u64,
    /// The failure or cancel reason on the final event.
    pub message: Option<String>,
    pub ts_ms: u64,
}

#[derive(Debug)]
struct Segment {
    announcement: FetchAnnouncement,
    blobs_dir: PathBuf,
    baseline: HashSet<String>,
    total: u64,
    done: u64,
}

/// Follows one installer run: lines in, progress snapshots out.
#[derive(Debug)]
pub struct Tracker {
    model: String,
    key: String,
    hub_cache: PathBuf,
    phase: DownloadPhase,
    segment: Option<Segment>,
    segments: u32,
    finished_bytes: u64,
    meter: SpeedMeter,
    message: Option<String>,
}

impl Tracker {
    pub fn new(model: &str, key: &str, hub_cache: PathBuf) -> Self {
        Self {
            model: model.to_string(),
            key: key.to_string(),
            hub_cache,
            phase: DownloadPhase::Checking,
            segment: None,
            segments: 0,
            finished_bytes: 0,
            meter: SpeedMeter::default(),
            message: None,
        }
    }

    pub fn phase(&self) -> DownloadPhase {
        self.phase
    }

    fn close_segment(&mut self) {
        if let Some(segment) = self.segment.as_mut() {
            segment.done = segment.total;
        }
    }

    fn finish_segment_bytes(&mut self) {
        if let Some(segment) = self.segment.take() {
            self.finished_bytes += segment.done.max(segment.total);
        }
    }

    /// Feeds one output line. Returns true when the phase changed.
    pub fn on_line(&mut self, line: &str) -> bool {
        let before = self.phase;
        if let Some(announcement) = parse_fetch_line(line) {
            self.close_segment();
            self.finish_segment_bytes();
            let blobs_dir = hfcache::repo_dir(&self.hub_cache, &announcement.repo).join("blobs");
            let baseline: HashSet<String> = hfcache::scan_blobs(&blobs_dir)
                .complete
                .into_keys()
                .collect();
            self.segments += 1;
            self.meter.reset();
            self.segment = Some(Segment {
                total: announcement.bytes,
                announcement,
                blobs_dir,
                baseline,
                done: 0,
            });
        }
        self.phase = phase_for_line(self.phase, line);
        if before == DownloadPhase::Downloading && self.phase == DownloadPhase::Preparing {
            self.close_segment();
        }
        if let Some(error) = line.trim().strip_prefix("error: ") {
            self.message = Some(error.to_string());
        }
        self.phase != before
    }

    /// Measures the current segment on disk.
    pub fn poll(&mut self, now_ms: u64) -> ModelProgress {
        if self.phase == DownloadPhase::Downloading {
            if let Some(segment) = self.segment.as_mut() {
                let measured = segment_bytes(&segment.blobs_dir, &segment.baseline);
                // The announced total is rounded to 10 MB: never report more
                // than 100%, and grow the total if the disk says so.
                segment.total = segment.total.max(measured);
                segment.done = measured;
                self.meter.sample(now_ms, measured);
            }
        }
        self.snapshot(now_ms)
    }

    pub fn snapshot(&self, now_ms: u64) -> ModelProgress {
        let (repo, done, total, files) = match &self.segment {
            Some(s) => (
                Some(s.announcement.repo.clone()),
                s.done,
                s.total,
                s.announcement.files,
            ),
            None => (None, 0, 0, 0),
        };
        let speed = if self.phase == DownloadPhase::Downloading {
            self.meter.rate()
        } else {
            0.0
        };
        let eta = (speed > 0.0 && total >= done).then(|| (total - done) as f64 / speed);
        ModelProgress {
            model: self.model.clone(),
            key: self.key.clone(),
            repo,
            bytes_done: done,
            bytes_total: total,
            speed,
            eta,
            phase: self.phase,
            segment: self.segments,
            files,
            overall_done: self.finished_bytes + done,
            message: self.message.clone(),
            ts_ms: now_ms,
        }
    }

    /// Sets the final phase from the installer's exit.
    pub fn finish(&mut self, phase: DownloadPhase, message: Option<String>) {
        if phase == DownloadPhase::Done {
            self.close_segment();
        }
        self.phase = phase;
        if message.is_some() {
            self.message = message;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install::testutil::TempDir;
    use crate::models::ids;

    #[test]
    fn parses_fetch_announcements() {
        let line = "Fetching 3 file(s), 16.82 GB, from unsloth/Qwen3.8-27B-GGUF@4ca720788d1e; cached files are reused.";
        assert_eq!(
            parse_fetch_line(line),
            Some(FetchAnnouncement {
                files: 3,
                bytes: 16_820_000_000,
                repo: "unsloth/Qwen3.8-27B-GGUF".into(),
                revision: "4ca720788d1e".into(),
            })
        );
        assert_eq!(
            parse_fetch_line("Fetching 1 file(s), 0.00 GB, from a/b@c; x").map(|a| a.bytes),
            Some(0)
        );
        assert!(parse_fetch_line("Selected x from y.").is_none());
        assert!(parse_fetch_line("Fetching lots").is_none());
    }

    #[test]
    fn phases_follow_installer_lines() {
        use DownloadPhase::*;
        assert_eq!(
            phase_for_line(
                Checking,
                "Another Splash model installation is running; waiting..."
            ),
            Queued
        );
        assert_eq!(phase_for_line(Queued, "Selected a.gguf from x."), Checking);
        assert_eq!(
            phase_for_line(
                Checking,
                "Fetching 1 file(s), 1.00 GB, from a/b@c; cached files are reused."
            ),
            Downloading
        );
        assert_eq!(phase_for_line(Downloading, "Warning: slow"), Downloading);
        assert_eq!(
            phase_for_line(Downloading, "Fetching 1 file(s), 0.10 GB, from a/d@e; x"),
            Downloading
        );
        assert_eq!(
            phase_for_line(Downloading, "Installed verified Splash model a/b in /x"),
            Preparing
        );
    }

    #[test]
    fn measures_new_and_partial_blobs_only() {
        let dir = TempDir::new("segment");
        dir.file("blobs/old", 1000);
        let baseline: HashSet<String> = ["old".to_string()].into();
        dir.file("blobs/new1", 300);
        dir.file("blobs/new2.aaaa.incomplete", 100);
        dir.file("blobs/new2.bbbb.incomplete", 150);
        // Finished, with a stale partial of the same blob left behind.
        dir.file("blobs/new3", 40);
        dir.file("blobs/new3.cccc.incomplete", 10);
        assert_eq!(
            segment_bytes(&dir.path().join("blobs"), &baseline),
            300 + 150 + 40
        );
    }

    #[test]
    fn tracks_a_download_in_a_temp_cache() {
        let dir = TempDir::new("tracker");
        let cache = dir.path().join("hub");
        let repo = "unsloth/Qwen3.8-27B-GGUF";
        let blobs = format!("hub/{}/blobs", ids::cache_folder_name(repo));
        dir.file(&format!("{blobs}/cached-config"), 5); // Already there: not counted.
                                                        // A partial from an interrupted attempt resumes.
        dir.file(&format!("{blobs}/target.1234.incomplete"), 200);

        let mut tracker = Tracker::new("unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M", "k", cache);
        assert!(
            !tracker.on_line("Selected Qwen3.8-27B-UD-Q4_K_M.gguf from unsloth/Qwen3.8-27B-GGUF.")
        );
        assert!(tracker.on_line(&format!(
            "Fetching 1 file(s), 0.00 GB, from {repo}@abc; cached files are reused."
        )));
        // Announced 0.00 GB (rounded): the total grows to what is on disk.
        let p = tracker.poll(0);
        assert_eq!(p.phase, DownloadPhase::Downloading);
        assert_eq!(p.bytes_done, 200);
        assert_eq!(p.bytes_total, 200);
        assert_eq!(p.repo.as_deref(), Some(repo));
        assert_eq!(p.segment, 1);

        dir.file(&format!("{blobs}/target.1234.incomplete"), 600);
        let p = tracker.poll(2000);
        assert_eq!(p.bytes_done, 600);
        assert!((p.speed - 200.0).abs() < 1e-6, "speed {}", p.speed);
        assert_eq!(p.eta, Some(0.0));

        // Renamed on completion: counted once.
        std::fs::remove_file(dir.path().join(format!("{blobs}/target.1234.incomplete")))
            .expect("rm");
        dir.file(&format!("{blobs}/target"), 600);
        assert_eq!(tracker.poll(3000).bytes_done, 600);

        // Next source: the draft.
        let draft = "incoai/Qwen3.8-27B-DFlash2";
        tracker.on_line(&format!(
            "Fetching 2 file(s), 0.00 GB, from {draft}@def; cached files are reused."
        ));
        let draft_blobs = format!("hub/{}/blobs", ids::cache_folder_name(draft));
        dir.file(&format!("{draft_blobs}/d1.x.incomplete"), 50);
        let p = tracker.poll(4000);
        assert_eq!(p.segment, 2);
        assert_eq!(p.bytes_done, 50);
        assert_eq!(p.overall_done, 650);
        assert_eq!(p.files, 2);

        assert!(tracker.on_line("Installed verified Splash model x in /y"));
        let p = tracker.poll(5000);
        assert_eq!(p.phase, DownloadPhase::Preparing);
        assert_eq!(p.bytes_done, p.bytes_total);
        assert_eq!(p.speed, 0.0);

        tracker.finish(DownloadPhase::Done, None);
        assert_eq!(tracker.snapshot(6000).phase, DownloadPhase::Done);
    }

    #[test]
    fn eta_from_announced_total() {
        let dir = TempDir::new("eta");
        let mut tracker = Tracker::new("a/b", "a/b", dir.path().to_path_buf());
        tracker.on_line("Fetching 1 file(s), 0.000001 GB, from a/b@c; cached files are reused.");
        let blobs = format!("{}/blobs", ids::cache_folder_name("a/b"));
        dir.file(&format!("{blobs}/x.1.incomplete"), 100);
        tracker.poll(0);
        dir.file(&format!("{blobs}/x.1.incomplete"), 500);
        let p = tracker.poll(1000);
        assert_eq!(p.bytes_total, 1000);
        assert_eq!(p.bytes_done, 500);
        assert!((p.speed - 400.0).abs() < 1e-6);
        assert!(p.eta.is_some_and(|e| (e - 1.25).abs() < 1e-6));
    }

    #[test]
    fn records_the_error_line() {
        let dir = TempDir::new("err");
        let mut tracker = Tracker::new("a/b", "a/b", dir.path().to_path_buf());
        tracker.on_line("error: no supported model has this architecture");
        tracker.finish(DownloadPhase::Failed, None);
        let p = tracker.snapshot(0);
        assert_eq!(p.phase, DownloadPhase::Failed);
        assert_eq!(
            p.message.as_deref(),
            Some("no supported model has this architecture")
        );
    }
}
