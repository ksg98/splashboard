//! The Mac Splash runs on: macOS version, chip, unified memory, and Metal's
//! `recommendedMaxWorkingSetSize` (the real ceiling for `--max-memory`).

use serde::Serialize;

/// Used when Metal cannot be asked: macOS lets the GPU wire about 3/4 of RAM
/// on most Apple-silicon Macs.
const ESTIMATE_FRACTION: f64 = 0.75;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    /// `sw_vers -productVersion`, e.g. "26.0".
    pub macos_version: Option<String>,
    /// e.g. "Apple M4 Max".
    pub chip: Option<String>,
    /// `hw.memsize`: unified memory in bytes.
    pub memory_bytes: Option<u64>,
    /// `uname -m`, e.g. "arm64".
    pub arch: String,
    /// Metal's recommended working set: what Splash can wire for weights,
    /// KV and buffers. An estimate when `metal_estimated` is true.
    pub metal_working_set_bytes: u64,
    /// True when Metal was not available and 0.75 x RAM was used.
    pub metal_estimated: bool,
    pub unified_memory: Option<bool>,
}

fn sysctl(name: &str) -> Option<String> {
    let output = std::process::Command::new("/usr/sbin/sysctl")
        .args(["-n", name])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

fn macos_version() -> Option<String> {
    sysctl("kern.osproductversion").or_else(|| {
        let output = std::process::Command::new("/usr/bin/sw_vers")
            .arg("-productVersion")
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        (!text.is_empty()).then_some(text)
    })
}

/// `(recommendedMaxWorkingSetSize, hasUnifiedMemory)` from the default
/// Metal device.
#[cfg(target_os = "macos")]
pub fn metal_working_set() -> Option<(u64, bool)> {
    use objc2_metal::{MTLCreateSystemDefaultDevice, MTLDevice};
    let device = MTLCreateSystemDefaultDevice()?;
    let size = device.recommendedMaxWorkingSetSize();
    (size > 0).then(|| (size, device.hasUnifiedMemory()))
}

#[cfg(not(target_os = "macos"))]
pub fn metal_working_set() -> Option<(u64, bool)> {
    None
}

/// Applies the fallback rule: Metal's value, else 0.75 x RAM (estimated).
pub fn working_set_or_estimate(
    metal: Option<(u64, bool)>,
    memory_bytes: Option<u64>,
) -> (u64, bool) {
    match metal {
        Some((size, _)) => (size, false),
        None => (
            memory_bytes
                .map(|m| (m as f64 * ESTIMATE_FRACTION) as u64)
                .unwrap_or(0),
            true,
        ),
    }
}

pub fn system_info() -> SystemInfo {
    let memory_bytes = sysctl("hw.memsize").and_then(|s| s.parse().ok());
    let metal = metal_working_set();
    let (metal_working_set_bytes, metal_estimated) = working_set_or_estimate(metal, memory_bytes);
    SystemInfo {
        macos_version: macos_version(),
        chip: sysctl("machdep.cpu.brand_string"),
        memory_bytes,
        arch: std::env::consts::ARCH.to_string(),
        metal_working_set_bytes,
        metal_estimated,
        unified_memory: metal.map(|(_, unified)| unified),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_fallback() {
        assert_eq!(
            working_set_or_estimate(Some((100, true)), Some(1000)),
            (100, false)
        );
        assert_eq!(working_set_or_estimate(None, Some(1000)), (750, true));
        assert_eq!(working_set_or_estimate(None, None), (0, true));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reads_this_mac() {
        let info = system_info();
        let memory = info.memory_bytes.unwrap_or_default();
        assert!(memory > 0, "{info:?}");
        assert!(info.macos_version.is_some(), "{info:?}");
        assert!(info.metal_working_set_bytes > 0, "{info:?}");
        assert!(info.metal_working_set_bytes <= memory, "{info:?}");
    }
}
