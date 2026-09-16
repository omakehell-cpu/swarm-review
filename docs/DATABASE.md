# The archive, and the one rule about touching it

`data/swarm-review.sqlite` is the whole app: every chapter, every version,
every note, the bible and the local copy of the wiki. It is SQLite in WAL
mode, which means **one writer at a time, and the writer must be on the
same machine as the file.**

That is not a style preference. SQLite's locking is built out of file locks
that a local filesystem honours and a network or virtual filesystem --
SMB, NFS, an SSH mount, a container's shared folder, anything that is not
the disk the file is on -- does not. Two writers without working locks do
not take turns. They interleave, and the result is not a lost write but a
**corrupt file**: pages that belong to one tree turning up in another, and
`database disk image is malformed` the next time anything reads it.

So:

- **To change anything in the archive by hand, stop the service first.**
  `node server.js` is the only writer; while it is up, nothing else opens
  that file for writing, from anywhere.
- **Never write to it from another machine at all**, mounted folder or
  not. Copy the file across, work on the copy, copy it back with the
  service stopped.
- Reading while the service runs is safe *as a query* and useless as a
  *copy*: `cp` of a live WAL database gives you a file that may be
  inconsistent, because the copy is taken while the write-ahead log is
  moving. Use the backup button on the admin page, or stop the service,
  for a copy worth keeping.
- **A test never touches this file.** `test/helpers/tmpdb.js` gives each
  run its own database, and `db.js` refuses to open the real one from
  inside a test process at all -- it throws rather than obeys. That guard
  exists because a test file required a library at the top which pulled in
  `db.js` before its own setup ran, and the suite emptied the live
  glossary into a fixture.

## When it has already gone wrong

`PRAGMA integrity_check` with the service **stopped** is the only answer
worth believing; run against a live database, or against a `cp` of one, it
reports damage that may only be in the copy.

If it is damaged, the file is rebuilt rather than repaired: a new database
made by the app's own schema, every row copied into it table by table, the
glossary taken from `data/backups/` (it is a copy of somebody else's wiki
and the least valuable thing in the file), and the search index left out of
the copy entirely and rebuilt from the text at the end. Anything derived
comes back; only what was written by hand is irreplaceable, and that is the
part a rebuild carries across first.
