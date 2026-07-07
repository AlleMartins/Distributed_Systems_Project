# Distributed_Systems_Project
1. Vision I intend to build a highly responsive, open-source, distributed "Real-Time Incident Management Dashboard" tailored for IT and Security Operations Centers. The platform allows operators to register new incidents, monitor live KPI metrics (such as total tickets, open vs. resolved ratios) via interactive charts, and collaborate by resolving open tickets. The core vision is to create a seamless, real-time, synchronized environment across all connected clients, backed by a scalable, containerized microservices architecture capable of handling concurrent modifications safely.

2. Learning Goals This project serves as a practical exploration of distributed systems patterns and cloud-native deployments. Specifically, I expect to learn and demonstrate:

    Concurrency Control (Optimistic Locking): Investigating how to safely handle simultaneous write requests. I will implement version-based optimistic locking to prevent race conditions when multiple operators attempt to resolve the same incident simultaneously. This ensures data integrity without the performance bottlenecks of pessimistic database locks.

    CAP Theorem in Practice: Analyzing the trade-offs between Availability and Consistency in a critical enterprise environment. Unlike generic collaborative tools that favor Availability (AP), this incident management system prioritizes Consistency (CP) for state mutations. I will explore how to provide a highly available real-time read stream via WebSockets, while strictly enforcing write consistency, preferring to reject a conflicting update (409 Conflict) rather than allowing a corrupted database state.

    Distributed Scalability & Orchestration: Moving beyond a monolithic approach by containerizing the application and orchestrating it via Kubernetes (Minikube).

    Cross-Node Communication: Understanding how to scale stateful WebSocket connections across multiple backend replicas using a Redis Pub/Sub adapter to ensure reliable event broadcasting.

3. Intended Technologies and Motivations

    Node.js & Express: To serve as a lightweight, non-blocking backend for REST API endpoints.

    Socket.io & Redis: Socket.io for bi-directional, low-latency event broadcasting. Redis will act as an adapter/message broker to synchronize WebSocket events across multiple backend Pods in the Kubernetes cluster.

    MongoDB (Replica Set): A NoSQL persistent storage that natively supports document versioning for optimistic locking and change streams.

    Vue.js & Chart.js: For building a reactive, similar to an enterprise UI that instantly reflects data changes in dynamic KPI charts.

    Docker & Kubernetes/Minikube: To simulate a real-world distributed infrastructure, managing deployments, scaling, and networking.

4. Intended Deliverables

    Source Code: GitHub repository containing the application code and Kubernetes configuration manifests.

    Demo: A locally deployed instance of the cluster running the dashboard.

5. Usage Scenarios

    Baseline Synchronization: When a new operator logs in, the client immediately requests the historical baseline of incidents from the database to render the initial charts, before subscribing to the live event stream.

    Concurrent Resolution Handling (Conflict): Two operators see an "open" incident and click "Resolve" simultaneously. The backend processes the first request, updates the ticket, and increments its version. The second request is rejected because the client's known version no longer matches the database, preventing data corruption.

    Real-Time Data Broadcasting: An operator registers a "High Database Latency" (for example) incident. The backend persists it and broadcasts the event. All connected dashboards worldwide instantly update their lists, adjust the KPI counters, and redraw the dynamic charts without manual page reloads.
    Crash Recovery & Self-Healing: If a backend replica (Pod) unexpectedly crashes, the Kubernetes orchestrator automatically detects the failure and spins up a new instance. Connected clients might briefly lose their WebSocket connection, but the library will automatically attempt to reconnect. Upon successful reconnection, the system relies on the persistent MongoDB Replica Set to recover the latest incident state, ensuring zero data loss and a seamless recovery process.
