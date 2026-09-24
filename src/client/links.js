// Anchors built from structured facts, identical to what wiki.resolveLinks
// writes (wiki-client lib/resolve.js), for markup drawn after emit returns —
// pulled ledger rows and the tool report. wiki.resolveLinks is only ever
// called synchronously inside emit; these never call it.
//
// The internal anchor's title is the search path the wiki follows when the
// link is clicked (pageHandler.context = title.split(' => ')), so a page on
// another site is reached by putting that site first.

import { escape, escapeAttr, sameSite, normSite, asSlug } from './parse.js'

export const internalAnchor = (title, context = [], site = null) => {
  const name = String(title || '')
  const slug = asSlug(name)
  const path = site ? [normSite(site), ...context.filter(s => !sameSite(s, site))] : context
  return `<a class="internal" href="/${escapeAttr(slug)}.html" data-page-name="${escapeAttr(slug)}" title="${escapeAttr(path.join(' => '))}">${escape(name)}</a>`
}

export const externalAnchor = (href, text) =>
  `<a class="external" target="_blank" href="${escapeAttr(href)}" title="${escapeAttr(href)}" rel="noopener">${escape(text)} <img src="/images/external-link-ltr-icon.png"></a>`

// A ledger or page ref as seen from a page on `site`: internal when it lives
// on `site`, external (new tab, the site in its address) otherwise.
//   ref = { name|title, site, href?, external? }
export const refAnchor = (ref, site, context = [], urlOf = null) => {
  const text = ref.title || ref.name || ref.slug
  if (!ref.site || sameSite(ref.site, site)) return internalAnchor(text, context)
  if (ref.external && ref.href) return externalAnchor(ref.href, text)
  return externalAnchor(urlOf ? urlOf(ref) : `//${ref.site}/view/${ref.slug}`, text)
}

// wiki.resolveLinks' own algorithm with an explicit search path: [[links]]
// become internal anchors, [href text] external ones, everything else is
// escaped. For text drawn outside emit, where the wiki's resolutionContext no
// longer belongs to this page.
export const resolveLike = (text, context = []) => {
  const stashed = []
  const stash = html => { stashed.push(html); return `〖${stashed.length - 1}〗` }
  const s = String(text === null || text === undefined ? '' : text)
    .replace(/〖(\d+)〗/g, '〖 $1 〗')
    .replace(/\[\[([^\]]+)\]\]/gi, (match, name) => asSlug(name).length ? stash(internalAnchor(name, context).replace('class="internal"', `class="${name === name.trim() ? 'internal' : 'internal spaced'}"`)) : match)
    .replace(/\[((?:(?:https?|ftp):|\/).*?) (.*?)\]/gi, (match, href, rest) => stash(externalAnchor(href, rest)))
  return escape(s).replace(/〖(\d+)〗/g, (m, d) => stashed[+d])
}
