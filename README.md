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
```
minikube start -p incident-board
```
### 2. Creazione del Namespace

Crea il namespace Kubernetes in cui verranno raggruppati tutti i servizi dell'applicazione:

```
kubectl create namespace app
```

### 3. Compilazione delle Immagini Docker

Per evitare di dover scaricare immagini da un registry esterno, compiliamo il backend e il frontend direttamente all'interno del demone Docker di Minikube.
Dalla cartella principale del progetto, esegui:
```
minikube image build -t api:latest ./api -p incident-board
minikube image build -t web:latest ./web -p incident-board
```

### 4. Deploy dell'Infrastruttura
Applica i file manifest di Kubernetes per avviare l'infrastruttura (MongoDB, Redis, API e Web). Esegui il comando puntando alla cartella in cui si trovano i tuoi file .yaml:
```
kubectl apply -f . -n app
```

Attendi che i Pod vengano creati eseguendo kubectl get pods -n app.
 
### 5. Inizializzazione del Replica Set (MongoDB)

Affinché i Change Streams e l'Optimistic Locking funzionino, MongoDB deve operare in modalità Replica Set. Se è la primissima volta che avvii il database, devi inizializzarlo.

Trova il nome del pod di MongoDB (es. mongo-5c4fbc7466-nqx88) ed esegui:
```
kubectl exec -it <NOME_POD_MONGO> -n app -- mongosh --eval "rs.initiate()"
```

### 6. Accesso all'Applicazione

Una volta che tutti i container sono nello stato Running, utilizza la funzione integrata di Minikube per esporre il servizio frontend. Questo comando aprirà automaticamente l'applicazione nel tuo browser:
```
minikube service web -n app -p incident-board
```
