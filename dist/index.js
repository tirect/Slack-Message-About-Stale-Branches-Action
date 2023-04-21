"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const axios = __importStar(require("axios"));
function run() {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const daysBeforeStale = parseInt(core.getInput("days-before-stale", { required: true }));
            const slackWebhookUrl = core.getInput("slack-webhook-url", {
                required: true,
            });
            if (typeof process.env.ACTIONS_RUNTIME_TOKEN === 'undefined') {
                throw new Error('ACTIONS_RUNTIME_TOKEN environment variable is not defined');
            }
            const octokit = github.getOctokit(process.env.ACTIONS_RUNTIME_TOKEN);
            const { owner, repo } = github.context.repo;
            const staleBranchesResponse = yield octokit.rest.repos.listBranches({
                owner,
                repo,
                protected: false,
                per_page: 100,
            });
            const staleBranches = staleBranchesResponse.data.filter((branch) => __awaiter(this, void 0, void 0, function* () {
                var _c, _d, _e;
                const commitResponse = yield octokit.rest.repos.getCommit({
                    owner,
                    repo,
                    ref: branch.commit.sha,
                    per_page: 1,
                    page: 1
                });
                const commitDate = ((_e = (_d = (_c = commitResponse === null || commitResponse === void 0 ? void 0 : commitResponse.data) === null || _c === void 0 ? void 0 : _c.commit) === null || _d === void 0 ? void 0 : _d.committer) === null || _e === void 0 ? void 0 : _e.date) !== undefined
                    ? new Date(commitResponse.data.commit.committer.date)
                    : undefined;
                if (!commitDate) {
                    return false;
                }
                const daysSinceLastCommit = (Date.now() - new Date(commitDate).getTime()) /
                    (1000 * 60 * 60 * 24);
                return daysSinceLastCommit >= daysBeforeStale;
            }));
            for (const staleBranch of staleBranches) {
                const branchName = staleBranch.name;
                const branchOwnerResponse = yield octokit.rest.repos.getBranch({
                    owner,
                    repo,
                    branch: branchName,
                });
                const branchOwner = ((_a = branchOwnerResponse.data.commit.author) === null || _a === void 0 ? void 0 : _a.login) || "UNKNOWN";
                console.log("branchName:", branchName);
                console.log("branchOwnerResponse.data:", branchOwnerResponse.data);
                console.log("branchOwnerResponse.data.commit:", branchOwnerResponse.data.commit);
                console.log("branchOwnerResponse.data.commit.author:", branchOwnerResponse.data.commit.author);
                console.log("branchOwnerResponse.data.commit.author.login:", (_b = branchOwnerResponse.data.commit.author) === null || _b === void 0 ? void 0 : _b.login);
                console.log("branchOwner:", branchOwner);
                const message = `Branch \`${branchName}\` is stale and owned by @${branchOwner}`;
                const payload = JSON.stringify({ text: message });
                yield axios.default.post(slackWebhookUrl, payload);
            }
        }
        catch (error) {
            core.setFailed(error.message);
        }
    });
}
run();
