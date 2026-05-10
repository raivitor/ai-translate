const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'

const setupItems = [
  'Backend local Express preparado para healthcheck e futuras sessoes OpenAI',
  'Renderer React/Vite rodando dentro do Electron com preload isolado',
  'OpenAI Realtime Translation previsto para gpt-realtime-translate via WebRTC',
  'Roteamento de audio previsto com VB-CABLE como microfone do Google Meet',
]

export function App() {
  return (
    <main className='app-shell'>
      <section className='status-panel' aria-labelledby='app-title'>
        <div>
          <span className='eyebrow'>Infra desktop</span>
          <h1 id='app-title'>Ai Translate</h1>
          <p>
            Base local preparada para evoluir para traducao em tempo real no
            Google Meet com Electron, React, backend Node e OpenAI Realtime
            Translation.
          </p>
        </div>

        <dl className='runtime-grid'>
          <div>
            <dt>API local</dt>
            <dd>{apiBaseUrl}</dd>
          </div>
          <div>
            <dt>Plataforma</dt>
            <dd>{window.aiTranslate.platform}</dd>
          </div>
          <div>
            <dt>Modelo alvo</dt>
            <dd>gpt-realtime-translate</dd>
          </div>
        </dl>
      </section>

      <section className='checklist' aria-label='Preparacao'>
        {setupItems.map(item => (
          <article key={item}>
            <span aria-hidden='true'>✓</span>
            <p>{item}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
