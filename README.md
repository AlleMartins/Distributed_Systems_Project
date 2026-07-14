# Real-Time Incident Management Dashboard

## Descrizione del Progetto
Questa applicazione è una dashboard distribuita progettata per i Security Operations Centers (SOC) e i team IT. Permette agli operatori di registrare, monitorare e risolvere incidenti in tempo reale. 

Il progetto è stato sviluppato come esplorazione pratica dei pattern architetturali tipici dei **Sistemi Distribuiti**, affrontando sfide reali come la gestione della concorrenza, la sincronizzazione dello stato e la tolleranza ai guasti (Crash Recovery).

### Funzionalità e Pattern Implementati
* **State Hydration & Real-time Sync:** I client scaricano uno snapshot iniziale dello storico tramite REST API al login e si iscrivono a un flusso WebSocket per ricevere le modifiche successive (rendendo la UI *Eventually Consistent*).
* **Optimistic Locking:** Gestione rigorosa delle race condition. Se due operatori tentano di risolvere lo stesso ticket simultaneamente, il backend garantisce la *Strict Consistency* utilizzando il versionamento del database, rifiutando l'aggiornamento obsoleto con un errore HTTP `409 Conflict`.
* **Cross-Node Event Broadcasting:** Le repliche del backend comunicano tra loro utilizzando un adapter Redis Pub/Sub per diffondere gli eventi WebSocket a tutti i client connessi, scalando orizzontalmente senza perdere messaggi.
* **High Availability & Self-Healing:** L'infrastruttura è containerizzata e orchestrata tramite Kubernetes. Il database utilizza uno **StatefulSet a 3 nodi con volumi persistenti** per garantire la tolleranza ai guasti (Failover automatico), supportato da PodDisruptionBudget e sonde di Liveness/Readiness sui microservizi.

### Stack Tecnologico
* **Frontend:** Vue.js, Chart.js, Nginx
* **Backend:** Node.js, Express.js, Socket.io
* **Database & Message Broker:** MongoDB (Stateful Replica Set), Redis
* **DevOps & Orchestration:** Docker, Kubernetes (Minikube con Ingress Addon)

## Guida all'Avvio (Ambiente di Sviluppo Minikube)

### Prerequisiti
Assicurati di avere installati e configurati sul tuo sistema:
* Docker
* Minikube
* kubectl
* Privilegi di amministratore (`sudo`) per configurare il routing locale.

### 1. Avvio del cluster e dell'Ingress
Avvia Minikube con un profilo dedicato e abilita l'addon Ingress, necessario per instradare correttamente le chiamate API e WebSocket dallo stesso dominio:
```
minikube start -p incident-board
minikube addons enable ingress -p incident-board
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
cd k8s/
kubectl apply -f . -n app
```

Attendi che i Pod vengano creati eseguendo ```kubectl get pods -n app```.


### 5. Configurazione del DNS Locale

L'Ingress è configurato per rispondere esclusivamente al dominio board.local. Aggiungi questo dominio al tuo file hosts di sistema:
```
echo "127.0.0.1 board.local" | sudo tee -a /etc/hosts
```

### 6. Attivazione del Tunnel e Accesso

Mantieni questo terminale aperto per permettere a Minikube di inoltrare il traffico dal tuo computer locale all'Ingress del cluster:
```
minikube tunnel -p incident-board
```

### 7. Apri il browser
Ora apri il tuo browser preferito e naviga all'indirizzo: ```http://board.local ```
