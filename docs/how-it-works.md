# How Session Keepalive Works

## Why sessions die in the first place

When you log into a site, the server creates a session (server-side record + a cookie in your browser identifying it). Most sites expire that session after some period of inactivity: every request you make resets the idle timer; go AFK too long and the server deletes the session, so your cookie points at nothing and you're logged out.

## What the extension does

It never stores or touches your password. It just keeps the idle timer from running out by pretending you're active:

1. **You protect a site** → it's saved with a ping URL (the page you were on) and an interval, and a repeating alarm is created:

```js
browser.alarms.create("keepalive:" + site.domain, { periodInMinutes: effectiveInterval(site, settings) });
```

2. **Every interval, the alarm fires a background request** to that URL:

```js
const res = await fetch(site.url, {
  method: "GET",
  credentials: "include",   // ← the key line
  cache: "no-store",        // don't let a cached copy satisfy it
  redirect: "follow"
});
```

`credentials: "include"` makes Firefox attach the same session cookies your logged-in tab uses (that's why the extension needs the `cookies` + `<all_urls>` permissions). From the server's perspective this request is indistinguishable from you refreshing the page, so it resets the inactivity timer and often re-issues a fresh cookie. Repeat every N minutes and the session never idles out.

3. **The response is checked, not just fired**: `classifyPing` looks at where the request actually landed. HTTP error → red dot; a 200 that got redirected to another domain or a `/login`/`/sso` path → yellow dot (that's the "you're logged out but the server said 200" case), and a flip from green triggers the desktop notification.

## The limits

- It resets inactivity timeouts, the overwhelmingly common kind. It can't beat absolute lifetimes (e.g. banks that force re-login every 8h regardless of activity) or servers that require re-authentication cryptographically.
- It only works while Firefox is running. A closed browser sends no pings.
- It rides on cookies you already have; if you actively log out, the cookie is invalidated and pinging can't bring the session back (you'll see the yellow/red dot + notification).
