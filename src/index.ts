import * as core from "@actions/core";
import * as github from "@actions/github";
import * as axios from "axios";
import {GitHub} from "@actions/github/lib/utils";
import { Endpoints } from "@octokit/types";

// Define the type for a branch
type Branch = Endpoints["GET /repos/{owner}/{repo}/branches"]["response"]["data"][number];

async function run() {
    try {
        const daysBeforeStale = parseInt(
            core.getInput("days-before-stale", {required: true})
        );
        const slackWebhookUrl = core.getInput("slack-webhook-url", {
            required: true,
        });
        if (typeof process.env.STALE_BRANCH_TOKEN === 'undefined') {
            throw new Error('STALE_BRANCH_TOKEN environment variable is not defined');
        }
        const octokit = github.getOctokit(process.env.STALE_BRANCH_TOKEN);
        const {owner, repo} = github.context.repo;

        const staleBranchesResponse = await getAllBranches(octokit, owner, repo);

        const staleBranchesByAuthor: { [key: string]: any[] } = {};

        const staleBranches = await Promise.all(
            staleBranchesResponse.map(async (branch) => {
                const daysSinceLastCommit = await getDaysSinceLastCommit(branch.commit.sha);
                return {
                    branch: branch,
                    daysSinceLastCommit: daysSinceLastCommit,
                };
            })
        ).then((branches) =>
            branches.filter((branch) => branch.daysSinceLastCommit >= daysBeforeStale)
        );

        for (const staleBranch of staleBranches) {
            const branchName = staleBranch.branch.name;

            const branchOwnerResponse = await octokit.rest.repos.getBranch({
                owner,
                repo,
                branch: branchName,
            });

            const branchOwner =
                branchOwnerResponse.data.commit.author?.login || "UNKNOWN";

            if (!staleBranchesByAuthor[branchOwner]) {
                staleBranchesByAuthor[branchOwner] = [];
            }

            staleBranchesByAuthor[branchOwner].push({
                name: branchName,
                daysSinceLastCommit: staleBranch.daysSinceLastCommit,
            });
        }

        for (const author in staleBranchesByAuthor) {
            staleBranchesByAuthor[author].sort((a, b) => b.daysSinceLastCommit - a.daysSinceLastCommit);
        }

        for (const author in staleBranchesByAuthor) {
            let message = `${getSlackUsername(author)} you have ${staleBranchesByAuthor[author].length} stale branches:\n`;
            for (const staleBranch of staleBranchesByAuthor[author]) {
                message += `\`${staleBranch.name}\` - stale by ${parseTime(staleBranch.daysSinceLastCommit)}\n`;
            }
            message += "\n\n====================\n\n"

            const payload = JSON.stringify({text: message});
            await axios.default.post(slackWebhookUrl, payload);
        }
    } catch
        (error: any) {
        core.setFailed(error.message);
    }
}

async function getAllBranches(octokit: ReturnType<typeof github.getOctokit>, owner: string, repo: string): Promise<Branch[]> {
    let branches: Branch[] = [];
    let page = 1;
    let response;

    do {
        response = await octokit.rest.repos.listBranches({
            owner,
            repo,
            protected: false,
            per_page: 100,
            page: page,
        });

        branches = branches.concat(response.data);
        page += 1;
    } while (response.data.length === 100);

    return branches;
}

function getSlackUsername(gitUsername: string): string {
    const slackUsers: Record<string, string> = Object.fromEntries(
        (process.env.SLACK_USERS || "").split(",").map((mapping) => mapping.split(":"))
    );
    return slackUsers[gitUsername] + ` (${gitUsername})` || "@" + gitUsername;
}
function parseTime(days: number): string {
    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    const remainingDays = Math.floor(days % 30);

    let timeFormat = "";

    if (years > 0) {
        timeFormat += `${years} year${years > 1 ? "s" : ""} `;
    }

    if (months > 0) {
        timeFormat += `${months} month${months > 1 ? "s" : ""} `;
    }

    if (remainingDays > 0) {
        timeFormat += `${remainingDays} day${remainingDays > 1 ? "s" : ""} `;
    }

    if (timeFormat === "") {
        timeFormat = "0 days";
    }

    return timeFormat.trim();
}

async function getDaysSinceLastCommit(sha: string): Promise<number> {
    if (typeof process.env.STALE_BRANCH_TOKEN === 'undefined') {
        throw new Error('STALE_BRANCH_TOKEN environment variable is not defined');
    }
    const octokit = github.getOctokit(process.env.STALE_BRANCH_TOKEN);
    const {owner, repo} = github.context.repo;
    const commitResponse = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: sha,
        per_page: 1,
        page: 1
    });

    const commitDate = commitResponse?.data?.commit?.committer?.date !== undefined
        ? new Date(commitResponse.data.commit.committer.date)
        : undefined;

    if (!commitDate) {
        return -1;
    }

    const daysSinceLastCommit =
        (Date.now() - new Date(commitDate).getTime()) /
        (1000 * 60 * 60 * 24);

    return daysSinceLastCommit;
}

run();
