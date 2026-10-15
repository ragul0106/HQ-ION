/**
 * Check a folder of scheme files without starting anything (the "reviewed import" step).
 *   npm run schemes:validate                 checks ./data/schemes (or $SCHEMES_DIR)
 *   npm run schemes:validate -- some/folder
 */
import { formatProblems, loadSchemes } from '../eligibility/loader.js';

const dir = process.argv[2] ?? process.env.SCHEMES_DIR ?? './data/schemes';

const result = await loadSchemes(dir);
if (result.ok) {
  const placeholders = result.schemes.filter((s) => s.placeholder).length;
  process.stdout.write(
    `OK: ${result.schemes.length} schemes in ${dir}` +
      (placeholders
        ? ` (${placeholders} are placeholders and will be refused on the live network)`
        : '') +
      '\n',
  );
} else {
  process.stderr.write(`INVALID scheme files in ${dir}:\n${formatProblems(result.problems)}\n`);
  process.exit(1);
}
