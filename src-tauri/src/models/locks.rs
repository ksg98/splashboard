//! `flock` checks matching Splash's own locks (`install/models.py`,
//! `install/assembly.py`). Only non-blocking attempts: Splashboard never
//! waits on Splash.

use std::fs::{File, OpenOptions};
use std::path::Path;

use nix::errno::Errno;
use nix::fcntl::{Flock, FlockArg};

use crate::install::{OpError, OpResult};

/// Whether a server holds the assembly whose `model.json` this is
/// (`assembly.is_held`: a shared lock is taken while serving).
pub fn is_held(model_json: &Path) -> bool {
    let Ok(file) = File::open(model_json) else {
        return false;
    };
    match Flock::lock(file, FlockArg::LockExclusiveNonblock) {
        Ok(lock) => {
            drop(lock);
            false
        }
        Err((_, errno)) => errno == Errno::EWOULDBLOCK,
    }
}

/// Exclusive hold of `models/.install.lock`, as Splash's installer takes it
/// for every write under the models folder. Released on drop.
pub fn try_install_lock(models_dir: &Path) -> OpResult<Flock<File>> {
    std::fs::create_dir_all(models_dir)?;
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(models_dir.join(".install.lock"))?;
    Flock::lock(file, FlockArg::LockExclusiveNonblock).map_err(|(_, errno)| {
        if errno == Errno::EWOULDBLOCK {
            OpError::Busy(
                "A Splash model installation is running; try again when it finishes.".into(),
            )
        } else {
            OpError::Io(std::io::Error::from(errno))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install::testutil::TempDir;

    #[test]
    fn detects_a_held_lock() {
        let dir = TempDir::new("locks");
        let record = dir.write("model.json", "{}");
        assert!(!is_held(&record));
        let shared = Flock::lock(
            File::open(&record).expect("open"),
            FlockArg::LockSharedNonblock,
        )
        .expect("lock");
        assert!(is_held(&record));
        drop(shared);
        assert!(!is_held(&record));
        assert!(!is_held(&dir.path().join("missing.json")));
    }

    #[test]
    fn install_lock_is_exclusive() {
        let dir = TempDir::new("install-lock");
        let first = try_install_lock(dir.path()).expect("first");
        assert!(matches!(
            try_install_lock(dir.path()),
            Err(OpError::Busy(_))
        ));
        drop(first);
        assert!(try_install_lock(dir.path()).is_ok());
    }
}
