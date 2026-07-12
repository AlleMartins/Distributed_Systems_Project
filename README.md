# Real-Time Incident Management Dashboard

## Descrizione del Progetto
Questa applicazione è una dashboard distribuita progettata per i Security Operations Centers (SOC) e i team IT. Permette agli operatori di registrare, monitorare e risolvere incidenti in tempo reale. 

Il progetto è stato sviluppato come esplorazione pratica dei pattern architetturali tipici dei **Sistemi Distribuiti**, affrontando sfide reali come la gestione della concorrenza, la sincronizzazione dello stato e la tolleranza ai guasti (Crash Recovery).

### Funzionalità e Pattern Implementati
* **State Hydration & Real-time Sync:** I client scaricano uno snapshot iniziale dello storico tramite REST API al login e si iscrivono a un flusso WebSocket per ricevere le modifiche successive (rendendo la UI *Eventually Consistent*).
* **Optimistic Locking:** Gestione rigorosa delle race condition. Se due operatori tentano di risolvere lo stesso ticket simultaneamente, il backend garantisce la *Strict Consistency* utilizzando il versionamento del database, rifiutando l'aggiornamento obsoleto con un errore HTTP `409 Conflict`.
* **Cross-Node Event Broadcasting:** Le repliche del backend comunicano tra loro utilizzando un adapter Redis Pub/Sub per diffondere gli eventi WebSocket a tutti i client connessi, scalando orizzontalmente senza perdere messaggi.
* **Self-Healing & Orchestration:** L'infrastruttura è containerizzata e orchestrata tramite Kubernetes, garantendo il ripristino automatico e la resilienza in caso di crash dei Pod.

### 🛠️ Stack Tecnologico
* **Frontend:** Vue.js, Chart.js
* **Backend:** Node.js, Express.js, Socket.io
* **Database & Message Broker:** MongoDB (Replica Set), Redis
* **DevOps & Orchestration:** Docker, Kubernetes (Minikube)

---

## 🚀 Guida all'Avvio (da zero)

### Prerequisiti
Assicurati di avere installati sul tuo sistema:
* Docker
* Minikube
* kubectl

### 1. Avvio del cluster Minikube
Avvia Minikube creando il profilo dedicato al progetto:
```bash
minikube start -p incident-board
