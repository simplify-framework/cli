# Simplify - Serverless
A minimalist and optimistic serverless framwork for AWS Lambda

`npm install -g simplify-cli`

```bash
╓───────────────────────────────────────────────────────────────╖
║              Simplify Framework - Version 0.1.38              ║
╙───────────────────────────────────────────────────────────────╜
simplify-cli init | deploy | destroy [options]

Options:
  --help        Show help                                              [boolean]
  --version     Show version number                                    [boolean]
  -c, --config  function configuration                       [string] [required]
  -p, --policy  function policy to attach                    [string] [required]
  -r, --role    function policy to attach                               [string]
  -s, --source  function source to deploy                    [string] [required]
  -e, --env     environment variable file                               [string]
  -u, --update  force update function code                             [boolean]
 ```
  
#### Init your environment

`simplify-cli init`

*** TODO:***
- Prepare your environment (.env file) with a `Function Name`
- Change function configuration if needed, eg: `MemorySize: 128`
- Change resource access policy to your database or others.

#### Deploy your function

`simplify-cli deploy`

#### Destroy your function

`simplify-cli destroy`

