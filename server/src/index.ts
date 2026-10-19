const mode = process.env.MODE ?? 'template'

if (mode === 'sqlite') {
  await import('./sqlite-listen.js')
} else if (mode === 'template') {
  const { startTemplateServer } = await import('./template-server.js')
  await startTemplateServer()
} else if (mode === 'showcase') {
  console.info('Showcase mode does not start an API. Run the Vite app; the site is read-only.')
} else {
  console.error(`Unknown MODE "${mode}". Use template, showcase, or sqlite.`)
  process.exit(1)
}
