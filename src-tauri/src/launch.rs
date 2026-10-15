//! Handing things to the OS: a web page to the browser, a file to the file manager.

use std::path::PathBuf;
use std::process::Command;

/// Links in GitHub text are written by anyone, so only http(s) passes, in the canonical
/// form a browser would use: scheme and host lowercased, spaces, quotes and non-ASCII
/// percent-encoded. The launchers get it as one argument, never through a shell.
fn openable(url: &str) -> Option<String> {
    let parsed = tauri::Url::parse(url).ok()?;
    let url = String::from(parsed);
    let plain = url
        .bytes()
        .all(|b| b.is_ascii_graphic() && !b"\"<>\\`".contains(&b));
    (url.starts_with("https://") || url.starts_with("http://"))
        .then_some(url)
        .filter(|_| plain)
}

/// Opens a web page in the default browser.
pub fn open_url(url: &str) -> Result<(), String> {
    launch(&openable(url).ok_or("refusing to open this URL")?)
}

/// Hands `url` to the OS's opener, as one argument.
fn launch(url: &str) -> Result<(), String> {
    let mut cmd = Command::new("open");
    // Not `cmd /C start`: cmd.exe re-parses the argument.
    crate::process::spawn(cmd.arg(url))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Selects `path` in the file manager.
pub fn reveal(path: PathBuf) -> Result<(), String> {
    // Waited on (it returns at once) so no zombie is left behind per click.
    match crate::process::spawn(Command::new("open").arg("-R").arg(path)).and_then(|mut c| c.wait())
    {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("open -R failed ({s})")),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openable_links() {
        let ok = |u: &str| openable(u).unwrap_or_else(|| panic!("{u}"));
        assert_eq!(
            ok("https://github.com/a/b/pull/1#issuecomment-2"),
            "https://github.com/a/b/pull/1#issuecomment-2"
        );
        assert_eq!(ok("HTTPS://Docs.RS/a?b=c&d"), "https://docs.rs/a?b=c&d");
        // Characters raw-HTML hrefs carry that a URL keeps as they are.
        assert_eq!(ok("https://x.com/it's/[1]|a"), "https://x.com/it's/[1]|a");
        assert_eq!(ok("https://x.com/ça va"), "https://x.com/%C3%A7a%20va");
        // Quotes and spaces can't survive into the argument.
        assert_eq!(
            ok("https://x.com/\"; rm -rf ~"),
            "https://x.com/%22;%20rm%20-rf%20~"
        );
        assert_eq!(openable("javascript:alert(1)"), None);
        assert_eq!(openable("file:///etc/passwd"), None);
        assert_eq!(openable("mailto:a@b.c"), None);
        assert_eq!(openable("not a url"), None);
    }
}
