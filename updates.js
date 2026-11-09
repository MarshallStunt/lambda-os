// Update check, like Lambda Rackside: reads the latest manifest.json from the public GitHub repo, at most every
// 2 hours (no GitHub sign-in needed).
// Chrome doesn't let an unpacked extension rewrite its own folder, so updating = pull (git copy) or copy the new ZIP
// over the folder, then reload the extension. Settings → Updates gives a one-line command that finds the folder.

const LambdaUpdates = (() => {
  const REPO = 'MarshallStunt/lambda-os';
  const EVERY_MS = 2 * 60 * 60 * 1000;
  const LINKS = {
    repo: `https://github.com/${REPO}`,
    changes: `https://github.com/${REPO}/commits/main`,
    zip: `https://github.com/${REPO}/archive/refs/heads/main.zip`,
  };
  // Help, ideas and bug reports go to the maintainer on Slack.
  const HELP = { name: 'Hadi Khodja', slack: 'https://lambda.slack.com/team/U0AAMLCUCUA' };
  const newer = (a, b) => {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
  };

  // → { ok, latest, current, available, error, at }
  async function check(force = false) {
    const current = chrome.runtime.getManifest().version;
    const { updateCheck: cached } = await chrome.storage.local.get('updateCheck');
    let r = cached;
    if (force || !r || Date.now() - r.at > EVERY_MS) {
      try {
        // github.com/…/raw/… redirects to a short-lived raw.githubusercontent.com link when the signed-in account can see the repo.
        const res = await fetch(`https://github.com/${REPO}/raw/main/manifest.json`, { credentials: 'include', cache: 'no-store' });
        if (res.status === 404) throw new Error(`the ${REPO} repo or its manifest.json wasn't found on GitHub`);
        if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
        const latest = (await res.json().catch(() => ({}))).version;
        if (!latest) throw new Error('GitHub sent back something other than the manifest');
        r = { ok: true, latest, at: Date.now() };
      } catch (e) {
        r = { ok: false, error: e.message, at: Date.now() };
      }
      await chrome.storage.local.set({ updateCheck: r });
    }
    return { ...r, current, available: !!r.ok && newer(r.latest, current) };
  }

  // A one-line command that finds this extension's folder from Chrome's own preferences, then pulls (git copy)
  // or downloads the new ZIP and opens the folder (ZIP copy).
  function command() {
    const id = chrome.runtime.id, ua = navigator.userAgent;
    const win = /Windows/.test(ua), edge = /\bEdg\//.test(ua), brave = !!navigator.brave;
    const note = 'Not a git copy: the new ZIP is downloading. Unzip it, copy its files into the folder that just opened, then reload the extension.';
    if (win) {
      const dir = `$env:LOCALAPPDATA\\${edge ? 'Microsoft\\Edge' : brave ? 'BraveSoftware\\Brave-Browser' : 'Google\\Chrome'}\\User Data`;
      return `$id='${id}'; $d = Get-ChildItem "${dir}\\*\\Secure Preferences","${dir}\\*\\Preferences" -ErrorAction SilentlyContinue | ` +
        `% { if ((Get-Content -Raw $_.FullName) -match ('"' + $id + '":\\{.*?"path":"([^"]*)"')) { [regex]::Unescape($Matches[1]) } } | Select-Object -First 1; ` +
        `if (-not $d) { 'lambda-os folder not found' } elseif (Test-Path "$d\\.git") { git -C "$d" pull } else { Start-Process '${LINKS.zip}'; explorer.exe $d; '${note}' }`;
    }
    if (!/Mac/.test(ua)) { // Linux / ChromeOS Linux: Chrome keeps profiles under ~/.config; read the extension's path with python3
      const dirs = edge ? ['~/.config/microsoft-edge'] : brave ? ['~/.config/BraveSoftware/Brave-Browser'] : ['~/.config/google-chrome', '~/.config/chromium', '~/.config/google-chrome-beta'];
      const files = dirs.map(d => `${d}/*/Secure\\ Preferences ${d}/*/Preferences`).join(' ');
      return `for f in ${files}; do d=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["extensions"]["settings"][sys.argv[2]]["path"])' "$f" ${id} 2>/dev/null) && [ -n "$d" ] && break; done; ` +
        `if [ -z "$d" ]; then echo "lambda-os folder not found"; elif [ -d "$d/.git" ]; then git -C "$d" pull; else xdg-open "${LINKS.zip}"; xdg-open "$d"; echo "${note}"; fi`;
    }
    const dir = `~/Library/Application\\ Support/${edge ? 'Microsoft\\ Edge' : brave ? 'BraveSoftware/Brave-Browser' : 'Google/Chrome'}`;
    return `for f in ${dir}/*/Secure\\ Preferences ${dir}/*/Preferences; do d=$(plutil -extract extensions.settings.${id}.path raw -o - "$f" 2>/dev/null) && break; done; ` +
      `if [ -z "$d" ]; then echo "lambda-os folder not found"; elif [ -d "$d/.git" ]; then git -C "$d" pull; else open "${LINKS.zip}"; open "$d"; echo "${note}"; fi`;
  }

  return { REPO, LINKS, HELP, check, command, newer };
})();

if (typeof self !== 'undefined') self.LambdaUpdates = LambdaUpdates;
