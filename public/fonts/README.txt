Typefaces used by this app, self-hosted so no page ever has to fetch a
font from Google or any other third party.

  literata-roman.woff2   Literata (TypeTogether / Google), variable weight
  literata-italic.woff2  Literata Italic
  inter.woff2            Inter (Rasmus Andersson), variable weight

Both families are licensed under the SIL Open Font License 1.1 -- see
LICENSE-Literata.txt and LICENSE-Inter.txt. Both files here are subsets
(Latin, Latin-1, Latin Extended-A, punctuation and a few arrows) of the
upstream variable fonts, converted to WOFF2; the originals are at
https://github.com/googlefonts/literata and https://github.com/rsms/inter.

They are served by tryServeStatic in server.js with a one-year immutable
cache header, so a changed font must ship under a new filename.
