// One public repo per granted wish: github.com/<GITHUB_ORG>/<slug>, MIT licensed, issues on.
import type { App } from './types'
export const org = () => process.env.GITHUB_ORG ?? 'genie-wishes' // read per call, so an org saved from the setup screen works without a restart
export const repoName = (app: App) => app.repo ?? app.slug
export const repoUrl = (app: App) => `https://github.com/${org()}/${repoName(app)}`
export const issuesUrl = (app: App) => `${repoUrl(app)}/issues`
