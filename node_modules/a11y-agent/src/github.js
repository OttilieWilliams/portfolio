import { Octokit } from '@octokit/rest';

function getOctokit() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN environment variable is required.');
  return new Octokit({ auth: token });
}

function getContext() {
  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.PR_NUMBER;
  if (!repo || !prNumber) {
    throw new Error('GITHUB_REPOSITORY and PR_NUMBER environment variables are required.');
  }
  const [owner, repoName] = repo.split('/');
  return { owner, repo: repoName, prNumber: parseInt(prNumber, 10) };
}

export async function postPRComment(body) {
  const octokit = getOctokit();
  const { owner, repo, prNumber } = getContext();

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}

export async function updatePRComment(body) {
  const octokit = getOctokit();
  const { owner, repo, prNumber } = getContext();

  const { data: comments } = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const existing = comments.find(c =>
    c.body.startsWith('## ♿ Accessibility audit') &&
    c.performed_via_github_app == null
  );

  if (existing) {
    await octokit.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
  }
}

export async function checkWriteAccess(username) {
  const octokit = getOctokit();
  const { owner, repo } = getContext();

  const { data } = await octokit.repos.getCollaboratorPermissionLevel({
    owner,
    repo,
    username,
  });

  return ['admin', 'write'].includes(data.permission);
}

export async function getPRHeadBranch() {
  const octokit = getOctokit();
  const { owner, repo, prNumber } = getContext();

  const { data } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  return data.head.ref;
}
