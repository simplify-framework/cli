const CUNDERLINE = '\x1b[4m'
const CRESET = '\x1b[0m'

const PLAN_DEFINITIONS = {
    "BASIC": {
        "Index": 0,
        "Version": "Community",
        "Description": "FREE membership with community access to development resources",
        "Subscription": 0
    },
    "PREMIUM": {
        "Index": 1,
        "Version": "Enterprise",
        "Description": "10$ per month with unlimited access to productionr ready resources",
        "Subscription": 10
    }
}
const AVAILABLE_COMMANDS = [
    { name: "init", desc: "setup project with AWS programmatic access", options: [
        { name: "help", desc: "display help for `init` command" }
    ] },
    { name: "list", desc: "list all deployemnts as snapshot to your cloud", options: [
        { name: "help", desc: "display help for `list` command" }
    ] },
    { name: "create", desc: "create a deployment `folder` from templates", options: [
        { name: "help", desc: "display help for `create` command" },
        { name: "name", desc: "another alterative deployment folder name" },
        { name: "template", desc: "a simplify `template` or a https://name/template.yaml" }
    ] },
    { name: "deploy", desc: "push a deployment `folder` to AWS cloud", options: [
        { name: "help", desc: "display help for `deploy` command" },
        { name: "stack", desc: "explicit as a stack for this deployment" },
        { name: "function", desc: "explicit as a function for this deployment" },
        { name: "parameters", desc: "stack parameters in JSON" },
        { name: "config", desc: "explicit the Configuration for `function` deployment" },
        { name: "policy", desc: "explicit the IAM policy for `function` deployment" },
        { name: "role", desc: "explicit the IAM role for `function` deployment" },
        { name: "src", desc: "specific the `source` folder for `function` deployment" },
        { name: "layer", desc: "deploy the `source` folder as a layer" },
        { name: "publish", desc: "publish new a version for `function`" },
        { name: "update", desc: "force update code for `function`" },
        { name: "region", desc: "selected region to deploy" },
        { name: "dotenv", desc: "another alternative env" },
        { name: "location", desc: "the root folder of this deployment" },
        { name: "headless", desc: "without prompt when deploying" }
    ] },
    { name: "destroy", desc: "cleanup your cloud deployment resource", options: [
        { name: "help", desc: "display help for `destroy` command" },
        { name: "stack", desc: "explicit as a stack for this deployment" },
        { name: "function", desc: "explicit as a function for this deployment" }
    ] },
    { name: "regiter", desc: "create an account to get support", options: [
        { name: "help", desc: "display help for `register` command" }
    ] },
    { name: "login", desc: "sign in as a registered user", options: [
        { name: "help", desc: "display help for `login` command" }
    ] },
    { name: "logout", desc: `sign out your current session (${CUNDERLINE}require login${CRESET})`, options: [
        { name: "help", desc: "display help for `logout` command" }
    ] },
    { name: "upgrade", desc: `upgrade your subscription plan (${CUNDERLINE}require login${CRESET})`, options: [
        { name: "help", desc: "display help for `upgrade` command" }
    ] },
    { name: "support", desc: `get support from our team (${CUNDERLINE}require login${CRESET})`, options: [
        { name: "help", desc: "display help for `support` command" }
    ] }
]
const ALLOWED_COMANDS = ["INIT", "LOGIN", "REGISTER", "CREATE", "DEPLOY", "DESTROY", "LIST"]

module.exports = {
    ALLOWED_COMANDS,
    AVAILABLE_COMMANDS,
    PLAN_DEFINITIONS
}
