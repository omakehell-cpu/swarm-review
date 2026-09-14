// Ambient types for the type-checker only. Nothing imports this file and
// nothing compiles it -- `npm run typecheck` picks it up, the running app
// never sees it.
//
// The app is plain CommonJS JavaScript and stays that way. What lives here
// is the handful of shapes the checker cannot work out on its own: the
// SQLite rows, the option bags passed around as object literals, and the
// two places we deliberately hang something extra off a built-in.

// ---------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------
// node:sqlite types every column as SQLOutputValue -- string | number |
// bigint | null | Uint8Array -- which is correct and useless: `story.id +
// 1` and `page.title.length` both become type errors, ~40 of them, and
// none of them is a bug. Rows here are what they are at runtime: values
// pulled out of columns this app created and whose shape its own schema
// fixes. Declaring them loose keeps the checker's attention on the code
// instead of on the column types.
type Row = Record<string, any>;

/**
 * The values a form is re-rendered with after a failed submit: whatever the
 * writer typed, straight off the request body, keyed by field name.
 */
type FormValues = Record<string, any>;

interface LooseStatement {
  all(...params: any[]): Row[];
  get(...params: any[]): Row | undefined;
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  iterate(...params: any[]): IterableIterator<Row>;
  setReadBigInts(enabled: boolean): void;
  setAllowBareNamedParameters(enabled: boolean): void;
  readonly sourceSQL: string;
  readonly expandedSQL: string;
  columns(): Array<Record<string, any>>;
}

interface LooseDatabase {
  prepare(sql: string): LooseStatement;
  exec(sql: string): void;
  close(): void;
  open(): void;
  readonly isOpen: boolean;
  function(name: string, fn: (...args: any[]) => any): void;
  function(name: string, options: Record<string, any>, fn: (...args: any[]) => any): void;
  backup(destination: string, options?: Record<string, any>): Promise<number>;
  [key: string]: any;
}

// ---------------------------------------------------------------------
// Page rendering
// ---------------------------------------------------------------------
// Every view function ends in a call to layout(). Without this the checker
// reads the first call it sees as the definitive shape and then objects to
// all the others for omitting a `wide` or a `flash` they never needed.
interface LayoutOptions {
  title: string;
  body: string;
  user?: Row | null;
  flash?: { type?: string; message: string } | null;
  wide?: boolean;
  /** Which nav entry to mark as the current page. */
  current?: string;
}

// ---------------------------------------------------------------------
// Deliberate extensions to built-ins
// ---------------------------------------------------------------------
interface Error {
  /**
   * Set on errors whose message is safe and useful to put in front of a
   * writer (a .docx that wouldn't open, say) rather than logging and
   * showing a generic 500.
   */
  userFacing?: boolean;
}

interface Window {
  /** The vendored nspell bundle at public/js/nspell.bundle.js. */
  NSpell?: any;
  /**
   * A seam for the test suite: the writing analyzer's pure detection
   * functions, so test/writing-checks.test.js can run them outside a
   * browser. Nothing in the app reads it.
   */
  __writingAnalyzer?: any;
}
