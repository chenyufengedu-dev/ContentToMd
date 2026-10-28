import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { installContextMenu } from './components/contextMenu'

installContextMenu()
createApp(App).mount('#app')
