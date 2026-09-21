import { createApp } from 'vue'
import App from './App.vue'

// Stili condivisi fra i componenti (palette, card, input, bottoni)
import './assets/styles.css'

// Importa Toastification e il suo CSS
import Toast from "vue-toastification"
import "vue-toastification/dist/index.css"

const app = createApp(App)

// Opzioni di configurazione per posizionare le notifiche in basso a destra
const toastOptions = {
    position: "bottom-right",
    timeout: 5000,
    closeOnClick: true,
    pauseOnFocusLoss: true,
    pauseOnHover: true,
    draggable: true,
    draggablePercent: 0.6,
    hideProgressBar: false,
    closeButton: "button",
    icon: true,
    rtl: false
};

app.use(Toast, toastOptions)
app.mount('#app')
