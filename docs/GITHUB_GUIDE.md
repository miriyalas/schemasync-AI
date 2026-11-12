# Commit this project to GitHub (github.com/miriyalas)

This guide puts the code in a new repository under your account, **https://github.com/miriyalas**, and connects it to CI and Vercel.

Target repository: **`https://github.com/miriyalas/schemasync-ai`**

---

## 1. One-time setup on your computer

1. Install **Git**: https://git-scm.com/downloads (Windows: accept the defaults).
2. Install **Node.js 20 LTS**: https://nodejs.org
3. Tell Git who you are (use the email on your GitHub account):

   ```bash
   git config --global user.name  "Your Name"
   git config --global user.email "you@example.com"
   git config --global init.defaultBranch main
   ```

4. Choose **one** way to sign in to GitHub from the command line:
   - **GitHub CLI (easiest)**: install from https://cli.github.com, then run `gh auth login` and follow the prompts (GitHub.com → HTTPS → login with a web browser).
   - **Personal access token**: GitHub → your photo → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. Give it access to the `schemasync-ai` repository with **Contents: Read and write** and **Workflows: Read and write**. When `git push` asks for a password, paste the token.
   - **GitHub Desktop**: https://desktop.github.com, if you prefer buttons to commands (see section 6).

## 2. Create the empty repository on GitHub

**Option A, website**

1. Go to https://github.com/new.
2. Owner: **miriyalas**. Repository name: **schemasync-ai**.
3. Visibility: **Private** (recommended, since it is an internal tool).
4. Do **not** tick "Add a README", ".gitignore" or "license" (the project already has them).
5. Click **Create repository**.

**Option B, GitHub CLI** (run inside the project folder, see step 3):

```bash
gh repo create miriyalas/schemasync-ai --private --source . --remote origin
```

## 3. First commit and push

Unzip `schemasync-ai.zip`, open a terminal **inside** the `schemasync-ai` folder, then:

```bash
# 1. check that it builds and the tests pass
npm install
npm test
npm run build

# 2. create the local repository and the first commit
git init
git add .
git status            # node_modules, .next, .env* and coverage must NOT be listed
git commit -m "feat: SchemaSync AI – schema compare, AI review, Excel export, SQL converter"

# 3. connect to GitHub and push
git remote add origin https://github.com/miriyalas/schemasync-ai.git
git branch -M main
git push -u origin main
```

Open https://github.com/miriyalas/schemasync-ai: the files and README should be there. The **Actions** tab shows the CI run (typecheck → tests with coverage → build).

> If `git push` is rejected because the remote has commits (for example, you ticked "Add a README"), run
> `git pull --rebase origin main` and push again.

## 4. Protect the main branch (recommended)

GitHub → repository → **Settings → Branches → Add branch ruleset** (or *Add rule*):

- Branch name pattern: `main`
- ✅ Require a pull request before merging
- ✅ Require status checks to pass → select **build** (the CI job)
- ✅ Block force pushes

From now on, changes go through pull requests and only merge when tests pass.

## 5. Day-to-day workflow

```bash
git checkout main
git pull                                  # get the latest
git checkout -b feature/oracle-packages   # one branch per change

# … edit code …
npm test                                  # keep the tests green
git add .
git commit -m "feat(oracle): compare package specs and bodies separately"
git push -u origin feature/oracle-packages
```

Then on GitHub click **Compare & pull request**, wait for the green CI check, and **Merge**.

Using the GitHub CLI instead: `gh pr create --fill` and `gh pr merge --squash`.

### Commit message convention

| Prefix | Use for |
|---|---|
| `feat:` | a new feature |
| `fix:` | a bug fix |
| `test:` | adding or changing tests only |
| `docs:` | documentation only |
| `refactor:` | code change with no behaviour change |
| `chore:` | dependencies, build, CI |

Example: `fix(converter): DATETIME2(7) now maps to TIMESTAMP`.

## 6. Using GitHub Desktop instead of commands

1. **File → Add local repository** → choose the `schemasync-ai` folder → click **create a repository** when asked.
2. Summary: `Initial commit` → **Commit to main**.
3. **Publish repository** → Owner **miriyalas**, name **schemasync-ai**, ✅ *Keep this code private* → **Publish**.
4. Later changes: edit, write a summary, **Commit**, **Push origin**.

## 7. Connect Vercel (automatic deploys)

1. https://vercel.com → **Sign up / Log in with GitHub**.
2. **Add New → Project** → **Import** `miriyalas/schemasync-ai`. If it is not listed, click **Adjust GitHub App Permissions** and grant access to the repository.
3. Framework: **Next.js** (auto-detected). Leave build settings as they are.
4. **Environment Variables**: add `APP_PASSWORD`, and optionally `AI_PROVIDER` with its API key (see `.env.example`).
5. **Deploy**.

After this:
- every push to `main` → production deploy;
- every pull request → its own preview URL, posted on the PR.

Full hosting options, including when Vercel cannot reach your databases: [HOSTING.md](HOSTING.md).

## 8. Never commit secrets

- `.env`, `.env.local` and `.env.*.local` are in `.gitignore`. Keep real keys and passwords there or in Vercel / GitHub settings, never in code.
- If a secret is committed by mistake: **rotate it immediately** (create a new key, delete the old one). Deleting the file in a later commit does not remove it from history.
- Optional: GitHub → **Settings → Code security → Secret scanning / Push protection** → enable.

## 9. Releases (optional)

```bash
git tag -a v1.0.0 -m "First release"
git push origin v1.0.0
gh release create v1.0.0 --generate-notes
```

## Quick reference

| Task | Command |
|---|---|
| See what changed | `git status`, `git diff` |
| Undo changes to a file (not committed) | `git restore path/to/file` |
| Unstage a file | `git restore --staged path/to/file` |
| Change the last commit message (not pushed) | `git commit --amend` |
| Get the latest from GitHub | `git pull` |
| Delete a merged branch | `git branch -d feature/x` |
