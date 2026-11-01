import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// 访问记一笔：每打开一次页面算一次 PV；带 ?r= 的算邀请链接打开
const params = new URLSearchParams(window.location.search)
fetch(`/api/hit${params.has('r') ? '?ref=1' : ''}`, { cache: 'no-store', keepalive: true }).catch(
  () => {},
)

createRoot(document.getElementById('root')).render(<App />)
