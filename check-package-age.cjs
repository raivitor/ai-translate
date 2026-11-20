const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')

const WARNING_THRESHOLD_DAYS = 365 * 2 // Alerta para pacotes sem update há 2 anos

const fetchPackageInfo = packageName =>
  new Promise((resolve, reject) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`

    https
      .get(url, res => {
        let data = ''

        if (res.statusCode === 404) {
          res.resume()
          resolve(null)
          return
        }

        if (res.statusCode >= 400) {
          res.resume()
          reject(new Error(`Falha ao consultar ${packageName}: HTTP ${res.statusCode}`))
          return
        }

        res.on('data', chunk => {
          data += chunk
        })
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (error) {
            reject(error)
          }
        })
      })
      .on('error', reject)
  })

const formatDate = dateString => (dateString ? new Date(dateString).toISOString().split('T')[0] : 'N/A')

const getDaysAgo = dateString => {
  if (!dateString) return 0
  return Math.floor((Date.now() - new Date(dateString).getTime()) / (1000 * 60 * 60 * 24))
}

const formatDeprecatedNote = message => {
  if (!message) return ''
  return message.length <= 30 ? message : `${message.substring(0, 30)}...`
}

async function analyzePackages() {
  const packageJsonPath = path.join(process.cwd(), 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    console.error('❌ Erro: nenhum package.json encontrado na raiz.')
    process.exitCode = 1
    return
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
  const depNames = Object.keys(allDeps)

  const results = await Promise.all(
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
            deprecated: '',
          }
        }

        const lastModified = info.time?.modified
        const latestVersion = info['dist-tags']?.latest || 'N/A'
        const deprecated = info.versions?.[latestVersion]?.deprecated || ''

        return {
          name,
          version: allDeps[name],
          lastUpdate: formatDate(lastModified),
          daysAgo: getDaysAgo(lastModified),
          deprecated,
        }
      } catch {
        return { name, version: allDeps[name], status: 'Erro na busca', lastUpdate: 'N/A', daysAgo: 0, deprecated: '' }
      }
    }),
  )

  results.sort((a, b) => {
    if (a.deprecated && !b.deprecated) return -1
    if (!a.deprecated && b.deprecated) return 1
    return b.daysAgo - a.daysAgo
  })

  const table = results.map(item => {
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

  console.log(`📦 ${pkg.name || 'ai-translate'} (${depNames.length} pacotes)\n`)
  console.table(table)
}

analyzePackages().catch(error => {
  console.error('Erro fatal:', error)
  process.exitCode = 1
})
