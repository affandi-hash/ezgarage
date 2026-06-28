import 'dotenv/config'
import express from 'express'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'motoverse-backend' })
})

// Routes (added per phase)
// import authRoutes from './routes/auth.js'
// import jobRoutes from './routes/jobs.js'
// app.use('/api/auth', authRoutes)
// app.use('/api/jobs', jobRoutes)

import staffRoutes from './routes/staff.js'
import usersRoutes from './routes/users.js'
app.use('/api/staff', staffRoutes)
app.use('/api/users', usersRoutes)

app.listen(PORT, () => {
  console.log(`Motoverse backend running on port ${PORT}`)
})
