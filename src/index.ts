import * as core from "@actions/core";
import * as github from "@actions/github";
import * as axios from "axios";
import { GitHub } from "@actions/github/lib/utils";
import { Endpoints } from "@octokit/types";

type Branch = Endpoints["GET /repos/{owner}/{repo}/branches"]["response"]["data"][number];

async function run() {
    try {
        const daysBeforeStale = parseInt(
            core.getInput("days-before-stale", { required: true })
        );
        const slackWebhookUrl = core.getInput("slack-webhook-url", {
            required: true,
        });
        if (typeof process.env.STALE_BRANCH_TOKEN === 'undefined') {
            throw new Error('STALE_BRANCH_TOKEN environment variable is not defined');
        }
        const octokit = github.getOctokit(process.env.STALE_BRANCH_TOKEN);
        const { owner, repo } = github.context.repo;

        const branches = await getAllBranches(octokit, owner, repo);

        const staleBranchesByAuthor: { [key: string]: any[] } = {};
        const now = Date.now();

        // Process branches in batches
        const batchSize = 10;
        for (let i = 0; i < branches.length; i += batchSize) {
            const batchBranches = branches.slice(i, i + batchSize);

            await Promise.all(
                batchBranches.map(async (branch) => {
                    try {
                        const commitInfo = await makeRequestWithRetry(() =>
                            octokit.rest.repos.getCommit({
                                owner,
                                repo,
                                ref: branch.commit.sha,
                            })
                        );

                        const commitDate = new Date(commitInfo.data.commit.committer?.date || '');
                        const daysSinceLastCommit = (now - commitDate.getTime()) / (1000 * 60 * 60 * 24);

                        if (daysSinceLastCommit >= daysBeforeStale) {
                            const author = commitInfo.data.author?.login || "UNKNOWN";

                            if (!staleBranchesByAuthor[author]) {
                                staleBranchesByAuthor[author] = [];
                            }

                            staleBranchesByAuthor[author].push({
                                name: branch.name,
                                daysSinceLastCommit: daysSinceLastCommit,
                            });
                        }
                    } catch (error) {
                        core.warning(`Failed to process branch ${branch.name}: ${error}`);
                    }
                })
            );
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

            const payload = JSON.stringify({ text: message });
            await axios.default.post(slackWebhookUrl, payload);
        }
    } catch (error: any) {
        core.setFailed(error.message);
    }
}

async function makeRequestWithRetry<T>(
    request: () => Promise<T>,
    maxRetries = 5
): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await request();
        } catch (error: any) {
            if (attempt === maxRetries) throw error;

            // Check for rate limit response
            if (error.response?.status === 403) {
                const retryAfter = error.response.headers['retry-after'];
                if (retryAfter) {
                    const waitTime = parseInt(retryAfter) * 1000; // Convert to milliseconds
                    core.info(`Rate limited. Waiting ${retryAfter} seconds before retry...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }
            }

            // For other errors or no retry-after header, use exponential backoff
            const waitTime = Math.pow(2, attempt) * 1000;
            core.info(`Request failed. Retrying in ${waitTime/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    throw new Error('Max retries exceeded');
}

async function getAllBranches(octokit: ReturnType<typeof github.getOctokit>, owner: string, repo: string): Promise<Branch[]> {
    const branches: Branch[] = [];
    let page = 1;
    const per_page = 100;

    try {
        while (true) {
            const response = await makeRequestWithRetry(() =>
                octokit.rest.repos.listBranches({
                    owner,
                    repo,
                    protected: false,
                    per_page,
                    page,
                })
            );

            branches.push(...response.data);

            if (response.data.length < per_page) {
                break;
            }

            page++;
        }
    } catch (error) {
        core.warning(`Error fetching branches: ${error}`);
    }

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

run();