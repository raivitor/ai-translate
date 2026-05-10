#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const ROOT_DIR = path.resolve(__dirname, '..')

const IGNORED_NPM_CONFIG_FLAGS = new Set([
  'audit',
  'bin_links',
  'fund',
  'foreground_scripts',
  'global',
  'ignore_scripts',
  'include_workspace_root',
  'package_lock',
  'save_exact',
  'workspaces',
  'yes',
])

const parseCliArgs = argv => {
  const positionals = []
  let projectName = null
  let dryRun = false
  let help = false

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }

    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }

    if (arg.startsWith('--name=')) {
      projectName = arg.slice('--name='.length)
      continue
    }

    if (arg.startsWith('--project=')) {
      projectName = arg.slice('--project='.length)
      continue
    }

    if (arg.startsWith('--') && !projectName) {
      projectName = arg.slice(2)
      continue
    }

    positionals.push(arg)
  }

  if (!projectName && positionals.length > 0) {
    projectName = positionals.join(' ')
  }

  if (!projectName) {
    projectName = discoverProjectNameFromNpmConfig()
  }

  return { dryRun, help, projectName }
}

const discoverProjectNameFromNpmConfig = () => {
  const candidates = Object.entries(process.env)
    .filter(([key, value]) => key.startsWith('npm_config_') && value === 'true')
    .map(([key]) => key.slice('npm_config_'.length))
    .filter(key => !IGNORED_NPM_CONFIG_FLAGS.has(key))

  if (candidates.length === 1) {
    return candidates[0].replaceAll('_', '-')
  }

  if (candidates.length > 1) {
    throw new Error(
      `Nao foi possivel deduzir o nome do projeto a partir dos argumentos: ${candidates.join(', ')}`,
    )
  }

  return null
}

const slugifyProjectName = value =>
  value
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')

const humanizeProjectName = value =>
  value
    .split('-')
    .filter(Boolean)
    .map(chunk => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ')

const updateJsonFile = (filePath, updater, updates, dryRun, baseDir = ROOT_DIR) => {
  const current = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const next = updater(current)
  const nextContent = `${JSON.stringify(next, null, 2)}\n`
  writeFileIfChanged(filePath, nextContent, updates, dryRun, baseDir)
}

const updateTextFile = (filePath, updater, updates, dryRun, baseDir = ROOT_DIR) => {
  const current = fs.readFileSync(filePath, 'utf8')
  const next = updater(current)
  writeFileIfChanged(filePath, next, updates, dryRun, baseDir)
}

const writeFileIfChanged = (filePath, nextContent, updates, dryRun, baseDir = ROOT_DIR) => {
  const current = fs.readFileSync(filePath, 'utf8')

  if (current === nextContent) {
    return
  }

  updates.push(path.relative(baseDir, filePath))

  if (!dryRun) {
    fs.writeFileSync(filePath, nextContent)
  }
}

const renderRootReadme = ({ displayName }) => `# ${displayName}

Aplicacao baseada no \`boilerplate-2026\`, com \`web\` em \`Next.js 16 + React 19\` e \`api\` em \`Express + TypeScript + Drizzle + Postgres\`.

## Requisitos

- Node 24
- npm 11+

## Setup inicial

\`\`\`bash
cp api/.env.example api/.env
nvm use
npm ci --prefix api
npm ci --prefix web
\`\`\`

Se for usar Postgres local via Docker:

\`\`\`bash
docker compose -f api/docker-compose.yml up -d
npm run db:migrate --prefix api
\`\`\`

## Desenvolvimento

\`\`\`bash
npm run dev --prefix api
npm run dev --prefix web
\`\`\`

## Qualidade

\`\`\`bash
npm run ci:simulate
npm run format:all
\`\`\`
`

const renderApiReadme = ({ displayName }) => `# ${displayName} API

API em \`Express + TypeScript + Drizzle + Postgres\`, com:

- healthcheck em \`/healthcheck\` e \`/api/healthcheck\`
- CRUD de exemplo em \`/api/items\`
- validacao com \`zod\`
- testes unitarios e de integracao com \`node:test\` e \`supertest\`

## Scripts

- \`npm run dev\`: sobe a API em modo watch
- \`npm run build\`: compila para \`dist\`
- \`npm test\`: executa testes unitarios
- \`npm run test:integration\`: executa integracoes HTTP com banco real
- \`npm run test:all\`: executa unitarios + integracao
- \`npm run validate\`: roda lint, typecheck e testes unitarios

## Banco de dados

1. Copie \`api/.env.example\` para \`api/.env\`.
2. Configure \`DATABASE_URL\`.
3. Configure \`TEST_DATABASE_URL\` apontando para um banco de testes dedicado.
4. Rode \`npm run db:migrate\`.

Para desenvolvimento local, o \`docker-compose.yml\` sobe um Postgres simples para a \`DATABASE_URL\`.
`

const renderWebReadme = ({ displayName }) => `# ${displayName} Web

Frontend em \`Next.js 16 + React 19\`.

## Scripts

- \`npm run dev\`: sobe o frontend em modo desenvolvimento
- \`npm run build\`: gera o build de producao
- \`npm run start\`: sobe o build gerado
- \`npm run validate\`: roda lint, typecheck e testes
`

const bootstrapProject = ({ rawProjectName, rootDir = ROOT_DIR, dryRun = false }) => {
  const projectSlug = slugifyProjectName(rawProjectName)

  if (!projectSlug) {
    throw new Error('Informe um nome de projeto valido.')
  }

  const displayName = humanizeProjectName(projectSlug)
  const apiPackageName = `${projectSlug}-api`
  const webPackageName = `${projectSlug}-web`
  const databaseName = projectSlug.replaceAll('-', '_')
  const updates = []

  updateJsonFile(
    path.join(rootDir, 'package.json'),
    packageJson => ({
      ...packageJson,
      name: projectSlug,
    }),
    updates,
    dryRun,
    rootDir,
  )

  updateJsonFile(
    path.join(rootDir, 'api', 'package.json'),
    packageJson => ({
      ...packageJson,
      name: apiPackageName,
      description: `${displayName} API built with Express + TypeScript + Drizzle + Postgres.`,
    }),
    updates,
    dryRun,
    rootDir,
  )

  updateJsonFile(
    path.join(rootDir, 'web', 'package.json'),
    packageJson => ({
      ...packageJson,
      name: webPackageName,
    }),
    updates,
    dryRun,
    rootDir,
  )

  updateTextFile(
    path.join(rootDir, 'api', 'package-lock.json'),
    content => content.replaceAll('"name": "boilerplate-api"', `"name": "${apiPackageName}"`),
    updates,
    dryRun,
    rootDir,
  )

  updateTextFile(
    path.join(rootDir, 'web', 'package-lock.json'),
    content => content.replaceAll('"name": "web"', `"name": "${webPackageName}"`),
    updates,
    dryRun,
    rootDir,
  )

  updateTextFile(
    path.join(rootDir, 'api', '.env.example'),
    content =>
      content
        .replace(/^POSTGRES_DB=.*$/m, `POSTGRES_DB=${databaseName}`)
        .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/${databaseName}`)
        .replace(
          /^TEST_DATABASE_URL=.*$/m,
          `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/${databaseName}_test`,
        ),
    updates,
    dryRun,
    rootDir,
  )

  updateTextFile(
    path.join(rootDir, 'api', 'docker-compose.yml'),
    content => content.replaceAll(/\$\{POSTGRES_DB:-[^}]+\}/g, `\${POSTGRES_DB:-${databaseName}}`),
    updates,
    dryRun,
    rootDir,
  )

  writeFileIfChanged(
    path.join(rootDir, 'README.md'),
    renderRootReadme({ displayName }),
    updates,
    dryRun,
    rootDir,
  )

  writeFileIfChanged(
    path.join(rootDir, 'api', 'README.md'),
    renderApiReadme({ displayName }),
    updates,
    dryRun,
    rootDir,
  )

  writeFileIfChanged(
    path.join(rootDir, 'web', 'README.md'),
    renderWebReadme({ displayName }),
    updates,
    dryRun,
    rootDir,
  )

  return {
    databaseName,
    displayName,
    dryRun,
    projectSlug,
    updates,
    webPackageName,
  }
}

const printUsage = () => {
  console.log(`Uso:

  npm run bootstrap -- meu-projeto
  npm run bootstrap -- --name=meu-projeto
  npm run bootstrap --meu-projeto

Opcoes:

  --dry-run    Mostra o que seria alterado sem escrever arquivos
  --help       Exibe esta ajuda
`)
}

const main = () => {
  try {
    const { dryRun, help, projectName } = parseCliArgs(process.argv.slice(2))

    if (help) {
      printUsage()
      return
    }

    if (!projectName) {
      printUsage()
      process.exitCode = 1
      return
    }

    const result = bootstrapProject({ rawProjectName: projectName, dryRun })

    if (result.updates.length === 0) {
      console.log(`Nenhuma alteracao necessaria. Projeto ja esta configurado como "${result.projectSlug}".`)
      return
    }

    const action = dryRun ? 'seriam alterados' : 'foram alterados'
    console.log(`Projeto configurado como "${result.displayName}" (${result.projectSlug}).`)
    console.log(`Arquivos que ${action}:`)

    for (const file of result.updates) {
      console.log(`- ${file}`)
    }

    if (!dryRun) {
      console.log('')
      console.log('Proximos passos:')
      console.log('- cp api/.env.example api/.env')
      console.log('- nvm use')
      console.log('- npm ci --prefix api')
      console.log('- npm ci --prefix web')
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  bootstrapProject,
  discoverProjectNameFromNpmConfig,
  parseCliArgs,
  slugifyProjectName,
}
