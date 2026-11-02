// Every commit a pull request adds is a Conventional Commit: the release workflow (.github/workflows/release.yml) decides
// each release from them with tishlang/sem, so a commit that is not one is a change the release cannot see. Merge
// commits are not checked.
//
//   node scripts/check-commits.mjs [base] [head]     # default origin/main and HEAD

import { execFileSync } from 'node:child_process'

const [base = 'origin/main', head = 'HEAD'] = process.argv.slice(2)
const TYPES = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'ci', 'build', 'chore', 'style', 'revert']
const HEADER = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9./-]*\\))?!?: \\S`)

const log = execFileSync('git', ['log', '--no-merges', '--format=%h%x09%s', `${base}..${head}`], {
  encoding: 'utf8',
}).trim()
const bad = log
  ? log
      .split('\n')
      .map((l) => l.split('\t'))
      .filter(([, subject]) => !HEADER.test(subject))
  : []
if (bad.length) {
  console.error(
    `${bad.length} commit(s) are not Conventional Commits — type(scope): summary, with type one of ${TYPES.join(', ')}:`,
  )
  for (const [sha, subject] of bad) console.error(`  ${sha}  ${subject}`)
  console.error(
    '\nfix:/perf: release a patch, feat: a minor, feat!: (or a BREAKING CHANGE: footer) a major; the rest release nothing.\nReword them (git rebase -i, then force-push the branch). See CONTRIBUTING.md.',
  )
  process.exit(1)
}
console.log(`${log ? log.split('\n').length : 0} commit(s), all Conventional Commits.`)
