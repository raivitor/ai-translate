const fs = require('fs')
const https = require('https')
const path = require('path')

const WARNING_THRESHOLD_DAYS = 365 * 2 // Alerta para pacotes sem update há 2 anos
const PACKAGE_INFO_CACHE = new Map()

// Função auxiliar para fazer requisição https (sem dependências externas como axios)
const fetchPackageInfo = packageName => {
  if (PACKAGE_INFO_CACHE.has(packageName)) {
    return PACKAGE_INFO_CACHE.get(packageName)
  }

  const request = new Promise((resolve, reject) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`

    https
      .get(url, res => {
        let data = ''

        if (res.statusCode === 404) {
          res.resume()
          resolve(null) // Pacote não encontrado (privado ou erro)
          return
        }

        if (res.statusCode >= 400) {
          res.resume()
          reject(new Error(`Falha ao consultar ${packageName}: HTTP ${res.statusCode}`))
          return
        }

        res.on('data', chunk => (data += chunk))

        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(e)
          }
        })
      })
      .on('error', err => reject(err))
  })

  PACKAGE_INFO_CACHE.set(packageName, request)
  return request
}

const formatDate = dateString => {
  if (!dateString) return 'N/A'
  return new Date(dateString).toISOString().split('T')[0] // YYYY-MM-DD
}

const getDaysAgo = dateString => {
  if (!dateString) return 0
  const diff = new Date() - new Date(dateString)
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

const getTargets = cwd => {
  const workspaceTargets = [
    { label: 'API', packageJsonPath: path.join(cwd, 'api', 'package.json') },
    { label: 'WEB', packageJsonPath: path.join(cwd, 'web', 'package.json') },
  ].filter(target => fs.existsSync(target.packageJsonPath))

  if (workspaceTargets.length > 0) {
    return workspaceTargets
  }

  const localPackageJsonPath = path.join(cwd, 'package.json')
  if (!fs.existsSync(localPackageJsonPath)) {
    return []
  }

  const currentDirName = path.basename(cwd).toLowerCase()
  const labelByDir = {
    api: 'API',
    web: 'WEB',
  }

  return [
    {
      label: labelByDir[currentDirName] || path.basename(cwd) || 'Projeto',
      packageJsonPath: localPackageJsonPath,
    },
  ]
}

const formatDeprecatedNote = deprecatedMessage => {
  if (!deprecatedMessage) return ''
  if (deprecatedMessage.length <= 30) return deprecatedMessage
  return `${deprecatedMessage.substring(0, 30)}...`
}

const formatTableData = data =>
  data.map(item => {
    let status = '✅ Ativo'
    if (item.deprecated) status = '💀 DEPRECIADO'
    else if (item.daysAgo > WARNING_THRESHOLD_DAYS) status = '⚠️  Abandonado?'
    else if (item.status) status = item.status

    return {
      Pacote: item.name,
      Instalado: item.version,
      'Último Update': item.lastUpdate,
      'Idade (dias)': item.daysAgo,
      Status: status,
      Nota: formatDeprecatedNote(item.deprecated),
    }
  })

async function analyzePackageTarget(target) {
  const pkg = JSON.parse(fs.readFileSync(target.packageJsonPath, 'utf8'))
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  }

  const depNames = Object.keys(allDeps)
  const data = await Promise.all(
    depNames.map(async name => {
      try {
        const info = await fetchPackageInfo(name)

        if (!info) {
          return {
            name,
            version: allDeps[name],
            status: '❓ Privado/Erro',
            lastUpdate: 'N/A',
            daysAgo: 0,
            deprecated: false,
          }
        }

        const time = info.time || {}
        const lastModified = time.modified
        const latestVersion = info['dist-tags']?.latest || 'N/A'
        const isDeprecated = info.versions?.[latestVersion]?.deprecated || false

        return {
          name,
          version: allDeps[name],
          latest: latestVersion,
          lastUpdate: formatDate(lastModified),
          daysAgo: getDaysAgo(lastModified),
          deprecated: isDeprecated,
        }
      } catch (err) {
        return {
          name,
          version: allDeps[name],
          status: 'Erro na busca',
          lastUpdate: 'N/A',
          daysAgo: 0,
          deprecated: false,
        }
      }
    }),
  )

  // Ordena: Depreciados primeiro, depois os mais antigos
  data.sort((a, b) => {
    if (a.deprecated && !b.deprecated) return -1
    if (!a.deprecated && b.deprecated) return 1
    return b.daysAgo - a.daysAgo
  })

  return {
    label: target.label,
    depCount: depNames.length,
    tableData: formatTableData(data),
  }
}

async function analyzePackages() {
  try {
    const targets = getTargets(process.cwd())

    if (targets.length === 0) {
      console.error('❌ Erro: nenhum package.json válido encontrado para análise.')
      return
    }

    const analyses = await Promise.all(targets.map(analyzePackageTarget))

    analyses.forEach((result, index) => {
      if (index > 0) {
        console.log('')
      }

      console.log(`📦 ${result.label} (${result.depCount} pacotes)\n`)
      console.table(result.tableData)
    })
  } catch (error) {
    console.error('Erro fatal:', error)
  }
}

analyzePackages()
