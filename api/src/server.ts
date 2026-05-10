import app from './app.js'

const PORT = process.env.PORT || 3001

app.listen(PORT, () => {
  console.warn(`Server is running on http://localhost:${PORT}`)
})
