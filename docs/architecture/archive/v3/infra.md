## Complete Kubernetes & Docker Setup

### 1. Docker Configuration

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY yarn.lock* ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source code
COPY . .

# Build application
RUN yarn build

# Production stage
FROM node:20-alpine AS production

RUN apk add --no-cache tini

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
```

```dockerfile
# Dockerfile.dev
FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install global dependencies
RUN npm install -g @nestjs/cli

COPY package*.json ./
COPY yarn.lock* ./

RUN yarn install

COPY . .

EXPOSE 3000 9229

CMD ["yarn", "start:dev"]
```

### 2. Docker Compose for Local Development

```yaml
# docker-compose.yml
version: '3.9'

services:
  # Application
  app:
    build:
      context: .
      dockerfile: Dockerfile.dev
    container_name: crypto-portfolio-app
    volumes:
      - .:/app
      - /app/node_modules
    ports:
      - '3000:3000'
      - '9229:9229' # Debug port
    environment:
      NODE_ENV: development
      DATABASE_WRITE_URL: postgresql://postgres:postgres@postgres-write:5432/crypto_portfolio_write
      DATABASE_READ_URL: postgresql://postgres:postgres@postgres-read:5432/crypto_portfolio_read
      REDIS_URL: redis://redis:6379
      RABBITMQ_URL: amqp://rabbitmq:rabbitmq@rabbitmq:5672
      ELASTICSEARCH_URL: http://elasticsearch:9200
      OLLAMA_URL: http://ollama:11434
    depends_on:
      postgres-write:
        condition: service_healthy
      postgres-read:
        condition: service_healthy
      redis:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
    networks:
      - crypto-net

  # PostgreSQL - Write Database
  postgres-write:
    image: postgres:15-alpine
    container_name: crypto-postgres-write
    environment:
      POSTGRES_DB: crypto_portfolio_write
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_INITDB_ARGS: '--encoding=UTF-8 --locale=en_US.UTF-8'
    volumes:
      - postgres-write-data:/var/lib/postgresql/data
      - ./infrastructure/database/init-write.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - '5432:5432'
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - crypto-net

  # PostgreSQL - Read Database (Replica simulation)
  postgres-read:
    image: postgres:15-alpine
    container_name: crypto-postgres-read
    environment:
      POSTGRES_DB: crypto_portfolio_read
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_INITDB_ARGS: '--encoding=UTF-8 --locale=en_US.UTF-8'
    volumes:
      - postgres-read-data:/var/lib/postgresql/data
      - ./infrastructure/database/init-read.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - '5433:5432'
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - crypto-net

  # Redis
  redis:
    image: redis:7-alpine
    container_name: crypto-redis
    command:
      redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy
      allkeys-lru
    volumes:
      - redis-data:/data
    ports:
      - '6379:6379'
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - crypto-net

  # RabbitMQ
  rabbitmq:
    image: rabbitmq:3.12-management-alpine
    container_name: crypto-rabbitmq
    environment:
      RABBITMQ_DEFAULT_USER: rabbitmq
      RABBITMQ_DEFAULT_PASS: rabbitmq
      RABBITMQ_DEFAULT_VHOST: /
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq
    ports:
      - '5672:5672'
      - '15672:15672' # Management UI
    healthcheck:
      test: ['CMD', 'rabbitmq-diagnostics', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - crypto-net

  # Elasticsearch
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.1
    container_name: crypto-elasticsearch
    environment:
      - discovery.type=single-node
      - 'ES_JAVA_OPTS=-Xms512m -Xmx512m'
      - xpack.security.enabled=false
    volumes:
      - elasticsearch-data:/usr/share/elasticsearch/data
    ports:
      - '9200:9200'
    healthcheck:
      test:
        ['CMD-SHELL', 'curl -f http://localhost:9200/_cluster/health || exit 1']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - crypto-net

  # Kibana
  kibana:
    image: docker.elastic.co/kibana/kibana:8.11.1
    container_name: crypto-kibana
    environment:
      ELASTICSEARCH_HOSTS: http://elasticsearch:9200
    ports:
      - '5601:5601'
    depends_on:
      elasticsearch:
        condition: service_healthy
    networks:
      - crypto-net

  # Ollama for Local LLM
  ollama:
    image: ollama/ollama:latest
    container_name: crypto-ollama
    volumes:
      - ollama-data:/root/.ollama
    ports:
      - '11434:11434'
    environment:
      OLLAMA_KEEP_ALIVE: '24h'
      OLLAMA_HOST: '0.0.0.0'
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    networks:
      - crypto-net

  # Ollama WebUI
  ollama-webui:
    image: ghcr.io/open-webui/open-webui:main
    container_name: crypto-ollama-webui
    volumes:
      - ollama-webui-data:/app/backend/data
    ports:
      - '8080:8080'
    environment:
      - OLLAMA_BASE_URL=http://ollama:11434
      - WEBUI_AUTH=false
    depends_on:
      - ollama
    networks:
      - crypto-net

  # Prometheus
  prometheus:
    image: prom/prometheus:latest
    container_name: crypto-prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
    volumes:
      - ./infrastructure/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    ports:
      - '9090:9090'
    networks:
      - crypto-net

  # Grafana
  grafana:
    image: grafana/grafana:latest
    container_name: crypto-grafana
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
      GF_USERS_ALLOW_SIGN_UP: false
    volumes:
      - grafana-data:/var/lib/grafana
      - ./infrastructure/monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./infrastructure/monitoring/grafana/datasources:/etc/grafana/provisioning/datasources
    ports:
      - '3001:3000'
    depends_on:
      - prometheus
    networks:
      - crypto-net

  # pgAdmin
  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: crypto-pgadmin
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@crypto.local
      PGADMIN_DEFAULT_PASSWORD: admin
      PGADMIN_CONFIG_SERVER_MODE: 'False'
    volumes:
      - pgadmin-data:/var/lib/pgadmin
    ports:
      - '5050:80'
    networks:
      - crypto-net

networks:
  crypto-net:
    driver: bridge

volumes:
  postgres-write-data:
  postgres-read-data:
  redis-data:
  rabbitmq-data:
  elasticsearch-data:
  ollama-data:
  ollama-webui-data:
  prometheus-data:
  grafana-data:
  pgadmin-data:
```

### 3. Kubernetes Manifests

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: crypto-portfolio
  labels:
    name: crypto-portfolio
    environment: production
```

```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: crypto-portfolio-config
  namespace: crypto-portfolio
data:
  NODE_ENV: 'production'
  PORT: '3000'
  LOG_LEVEL: 'info'
  REDIS_PREFIX: 'crypto'
  CACHE_TTL: '3600'

---
apiVersion: v1
kind: ConfigMap
metadata:
  name: crypto-portfolio-db-config
  namespace: crypto-portfolio
data:
  WRITE_DB_HOST: 'postgres-write-service'
  WRITE_DB_PORT: '5432'
  WRITE_DB_NAME: 'crypto_portfolio_write'
  READ_DB_HOST: 'postgres-read-service'
  READ_DB_PORT: '5432'
  READ_DB_NAME: 'crypto_portfolio_read'
```

```yaml
# k8s/secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: crypto-portfolio-secrets
  namespace: crypto-portfolio
type: Opaque
stringData:
  JWT_SECRET: 'your-super-secret-jwt-key-change-in-production'
  DATABASE_PASSWORD: 'postgres'
  REDIS_PASSWORD: ''
  RABBITMQ_PASSWORD: 'rabbitmq'
  BINANCE_API_KEY: 'your-binance-api-key'
  BINANCE_API_SECRET: 'your-binance-api-secret'
  COINBASE_API_KEY: 'your-coinbase-api-key'
  COINBASE_API_SECRET: 'your-coinbase-api-secret'
```

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: crypto-portfolio-app
  namespace: crypto-portfolio
  labels:
    app: crypto-portfolio
    component: backend
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: crypto-portfolio
      component: backend
  template:
    metadata:
      labels:
        app: crypto-portfolio
        component: backend
      annotations:
        prometheus.io/scrape: 'true'
        prometheus.io/port: '3000'
        prometheus.io/path: '/metrics'
    spec:
      serviceAccountName: crypto-portfolio
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        fsGroup: 1001
      containers:
        - name: app
          image: jbelanger/crypto-portfolio:latest
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: 3000
              protocol: TCP
            - name: metrics
              containerPort: 9090
              protocol: TCP
          env:
            - name: NODE_ENV
              valueFrom:
                configMapKeyRef:
                  name: crypto-portfolio-config
                  key: NODE_ENV
            - name: PORT
              valueFrom:
                configMapKeyRef:
                  name: crypto-portfolio-config
                  key: PORT
            - name: DATABASE_WRITE_URL
              value: 'postgresql://postgres:$(DATABASE_PASSWORD)@postgres-write-service:5432/crypto_portfolio_write'
            - name: DATABASE_READ_URL
              value: 'postgresql://postgres:$(DATABASE_PASSWORD)@postgres-read-service:5432/crypto_portfolio_read'
            - name: REDIS_URL
              value: 'redis://redis-service:6379'
            - name: RABBITMQ_URL
              value: 'amqp://rabbitmq:$(RABBITMQ_PASSWORD)@rabbitmq-service:5672'
            - name: ELASTICSEARCH_URL
              value: 'http://elasticsearch-service:9200'
            - name: OLLAMA_URL
              value: 'http://ollama-service:11434'
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: crypto-portfolio-secrets
                  key: JWT_SECRET
            - name: DATABASE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: crypto-portfolio-secrets
                  key: DATABASE_PASSWORD
          resources:
            requests:
              memory: '256Mi'
              cpu: '250m'
            limits:
              memory: '512Mi'
              cpu: '500m'
          livenessProbe:
            httpGet:
              path: /api/v1/health/live
              port: http
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /api/v1/health/ready
              port: http
            initialDelaySeconds: 10
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
```

```yaml
# k8s/postgres.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres-write
  namespace: crypto-portfolio
spec:
  serviceName: postgres-write-service
  replicas: 1
  selector:
    matchLabels:
      app: postgres-write
  template:
    metadata:
      labels:
        app: postgres-write
    spec:
      containers:
        - name: postgres
          image: postgres:15-alpine
          ports:
            - containerPort: 5432
              name: postgres
          env:
            - name: POSTGRES_DB
              value: crypto_portfolio_write
            - name: POSTGRES_USER
              value: postgres
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: crypto-portfolio-secrets
                  key: DATABASE_PASSWORD
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          volumeMounts:
            - name: postgres-storage
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              memory: '256Mi'
              cpu: '250m'
            limits:
              memory: '1Gi'
              cpu: '1'
  volumeClaimTemplates:
    - metadata:
        name: postgres-storage
      spec:
        accessModes: ['ReadWriteOnce']
        storageClassName: 'standard'
        resources:
          requests:
            storage: 10Gi

---
apiVersion: v1
kind: Service
metadata:
  name: postgres-write-service
  namespace: crypto-portfolio
spec:
  type: ClusterIP
  ports:
    - port: 5432
      targetPort: 5432
  selector:
    app: postgres-write

---
# Similar configuration for postgres-read
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres-read
  namespace: crypto-portfolio
spec:
  serviceName: postgres-read-service
  replicas: 1
  selector:
    matchLabels:
      app: postgres-read
  template:
    metadata:
      labels:
        app: postgres-read
    spec:
      containers:
        - name: postgres
          image: postgres:15-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_DB
              value: crypto_portfolio_read
            - name: POSTGRES_USER
              value: postgres
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: crypto-portfolio-secrets
                  key: DATABASE_PASSWORD
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          volumeMounts:
            - name: postgres-storage
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              memory: '256Mi'
              cpu: '250m'
            limits:
              memory: '1Gi'
              cpu: '1'
  volumeClaimTemplates:
    - metadata:
        name: postgres-storage
      spec:
        accessModes: ['ReadWriteOnce']
        storageClassName: 'standard'
        resources:
          requests:
            storage: 10Gi

---
apiVersion: v1
kind: Service
metadata:
  name: postgres-read-service
  namespace: crypto-portfolio
spec:
  type: ClusterIP
  ports:
    - port: 5432
      targetPort: 5432
  selector:
    app: postgres-read
```

```yaml
# k8s/redis.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: crypto-portfolio
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          command:
            - redis-server
            - '--appendonly'
            - 'yes'
            - '--maxmemory'
            - '256mb'
            - '--maxmemory-policy'
            - 'allkeys-lru'
          ports:
            - containerPort: 6379
          volumeMounts:
            - name: redis-storage
              mountPath: /data
          resources:
            requests:
              memory: '128Mi'
              cpu: '100m'
            limits:
              memory: '256Mi'
              cpu: '200m'
      volumes:
        - name: redis-storage
          persistentVolumeClaim:
            claimName: redis-pvc

---
apiVersion: v1
kind: Service
metadata:
  name: redis-service
  namespace: crypto-portfolio
spec:
  type: ClusterIP
  ports:
    - port: 6379
      targetPort: 6379
  selector:
    app: redis

---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: redis-pvc
  namespace: crypto-portfolio
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
```

```yaml
# k8s/ollama.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ollama
  namespace: crypto-portfolio
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ollama
  template:
    metadata:
      labels:
        app: ollama
    spec:
      containers:
        - name: ollama
          image: ollama/ollama:latest
          ports:
            - containerPort: 11434
          env:
            - name: OLLAMA_KEEP_ALIVE
              value: '24h'
            - name: OLLAMA_HOST
              value: '0.0.0.0'
          volumeMounts:
            - name: ollama-storage
              mountPath: /root/.ollama
          resources:
            requests:
              memory: '4Gi'
              cpu: '2'
            limits:
              memory: '8Gi'
              cpu: '4'
              nvidia.com/gpu: '1' # Request GPU if available
      volumes:
        - name: ollama-storage
          persistentVolumeClaim:
            claimName: ollama-pvc

---
apiVersion: v1
kind: Service
metadata:
  name: ollama-service
  namespace: crypto-portfolio
spec:
  type: ClusterIP
  ports:
    - port: 11434
      targetPort: 11434
  selector:
    app: ollama

---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ollama-pvc
  namespace: crypto-portfolio
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 50Gi # Models can be large
```

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: crypto-portfolio-ingress
  namespace: crypto-portfolio
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
    nginx.ingress.kubernetes.io/ssl-redirect: 'true'
    cert-manager.io/cluster-issuer: 'letsencrypt-prod'
    nginx.ingress.kubernetes.io/rate-limit: '100'
    nginx.ingress.kubernetes.io/proxy-body-size: '10m'
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - api.crypto-portfolio.local
      secretName: crypto-portfolio-tls
  rules:
    - host: api.crypto-portfolio.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: crypto-portfolio-service
                port:
                  number: 80
```

```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: crypto-portfolio-service
  namespace: crypto-portfolio
  labels:
    app: crypto-portfolio
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 3000
      protocol: TCP
      name: http
    - port: 9090
      targetPort: 9090
      protocol: TCP
      name: metrics
  selector:
    app: crypto-portfolio
    component: backend
```

### 4. Horizontal Pod Autoscaler

```yaml
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: crypto-portfolio-hpa
  namespace: crypto-portfolio
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: crypto-portfolio-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
        - type: Pods
          value: 2
          periodSeconds: 60
```

### 5. Skaffold Configuration

```yaml
# skaffold.yaml
apiVersion: skaffold/v4beta6
kind: Config
metadata:
  name: crypto-portfolio
build:
  artifacts:
    - image: jbelanger/crypto-portfolio
      docker:
        dockerfile: Dockerfile
  tagPolicy:
    gitCommit: {}
  local:
    push: false
deploy:
  kubectl:
    manifests:
      - k8s/*.yaml
portForward:
  - resourceType: service
    resourceName: crypto-portfolio-service
    namespace: crypto-portfolio
    port: 80
    localPort: 3000
  - resourceType: service
    resourceName: postgres-write-service
    namespace: crypto-portfolio
    port: 5432
    localPort: 5432
  - resourceType: service
    resourceName: redis-service
    namespace: crypto-portfolio
    port: 6379
    localPort: 6379
profiles:
  - name: dev
    activation:
      - env: SKAFFOLD_PROFILE=dev
    build:
      artifacts:
        - image: jbelanger/crypto-portfolio
          docker:
            dockerfile: Dockerfile.dev
          sync:
            manual:
              - src: 'src/**/*'
                dest: /app
    deploy:
      kubectl:
        manifests:
          - k8s/dev/*.yaml
```

### 6. Helm Chart

```yaml
# helm/crypto-portfolio/Chart.yaml
apiVersion: v2
name: crypto-portfolio
description: A Helm chart for Crypto Portfolio Application
type: application
version: 1.0.0
appVersion: '1.0.0'
dependencies:
  - name: postgresql
    version: 12.x.x
    repository: https://charts.bitnami.com/bitnami
    alias: postgres-write
  - name: postgresql
    version: 12.x.x
    repository: https://charts.bitnami.com/bitnami
    alias: postgres-read
  - name: redis
    version: 17.x.x
    repository: https://charts.bitnami.com/bitnami
  - name: rabbitmq
    version: 12.x.x
    repository: https://charts.bitnami.com/bitnami
  - name: elasticsearch
    version: 19.x.x
    repository: https://helm.elastic.co
```

```yaml
# helm/crypto-portfolio/values.yaml
replicaCount: 3

image:
  repository: jbelanger/crypto-portfolio
  pullPolicy: IfNotPresent
  tag: 'latest'

serviceAccount:
  create: true
  annotations: {}
  name: ''

podAnnotations:
  prometheus.io/scrape: 'true'
  prometheus.io/port: '3000'
  prometheus.io/path: '/metrics'

service:
  type: ClusterIP
  port: 80
  targetPort: 3000

ingress:
  enabled: true
  className: 'nginx'
  annotations:
    cert-manager.io/cluster-issuer: 'letsencrypt-prod'
    nginx.ingress.kubernetes.io/rate-limit: '100'
  hosts:
    - host: api.crypto-portfolio.local
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: crypto-portfolio-tls
      hosts:
        - api.crypto-portfolio.local

resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 250m
    memory: 256Mi

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80

postgres-write:
  auth:
    postgresPassword: postgres
    database: crypto_portfolio_write
  persistence:
    enabled: true
    size: 10Gi

postgres-read:
  auth:
    postgresPassword: postgres
    database: crypto_portfolio_read
  persistence:
    enabled: true
    size: 10Gi

redis:
  auth:
    enabled: false
  master:
    persistence:
      enabled: true
      size: 5Gi

rabbitmq:
  auth:
    username: rabbitmq
    password: rabbitmq
  persistence:
    enabled: true
    size: 5Gi

elasticsearch:
  replicas: 1
  minimumMasterNodes: 1
  resources:
    requests:
      cpu: '1000m'
      memory: '2Gi'
    limits:
      cpu: '2000m'
      memory: '4Gi'
```

### 7. Makefile for Operations

```makefile
# Makefile
.PHONY: help build push deploy clean

REGISTRY := jbelanger
IMAGE := crypto-portfolio
VERSION := $(shell git describe --tags --always --dirty)
NAMESPACE := crypto-portfolio

help:
	@echo "Available commands:"
	@echo "  make build          - Build Docker image"
	@echo "  make push           - Push image to registry"
	@echo "  make deploy-local   - Deploy to local Kubernetes"
	@echo "  make deploy-prod    - Deploy to production"
	@echo "  make setup-local    - Setup local development with Docker Compose"
	@echo "  make clean          - Clean up resources"

# Docker commands
build:
	docker build -t $(REGISTRY)/$(IMAGE):$(VERSION) .
	docker tag $(REGISTRY)/$(IMAGE):$(VERSION) $(REGISTRY)/$(IMAGE):latest

push: build
	docker push $(REGISTRY)/$(IMAGE):$(VERSION)
	docker push $(REGISTRY)/$(IMAGE):latest

# Local development
setup-local:
	docker-compose up -d
	@echo "Waiting for services to be ready..."
	@sleep 10
	@echo "Running migrations..."
	yarn migration:run
	@echo "Pulling Ollama models..."
	docker exec crypto-ollama ollama pull llama2
	docker exec crypto-ollama ollama pull codellama
	@echo "Local environment ready!"
	@echo "Services available at:"
	@echo "  - API: http://localhost:3000"
	@echo "  - RabbitMQ: http://localhost:15672"
	@echo "  - Kibana: http://localhost:5601"
	@echo "  - Grafana: http://localhost:3001"
	@echo "  - pgAdmin: http://localhost:5050"
	@echo "  - Ollama WebUI: http://localhost:8080"

stop-local:
	docker-compose down

clean-local:
	docker-compose down -v

# Kubernetes commands
setup-k8s:
	kubectl create namespace $(NAMESPACE) --dry-run=client -o yaml | kubectl apply -f -
	kubectl apply -f k8s/secrets.yaml
	kubectl apply -f k8s/configmap.yaml

deploy-local: build
	kubectl config use-context docker-desktop
	$(MAKE) setup-k8s
	kubectl apply -f k8s/ -n $(NAMESPACE)
	@echo "Deployment complete!"
	@echo "Port forwarding..."
	kubectl port-forward -n $(NAMESPACE) svc/crypto-portfolio-service 3000:80

deploy-prod: push
	kubectl config use-context production
	$(MAKE) setup-k8s
	kubectl set image deployment/crypto-portfolio-app app=$(REGISTRY)/$(IMAGE):$(VERSION) -n $(NAMESPACE)
	kubectl rollout status deployment/crypto-portfolio-app -n $(NAMESPACE)

# Helm commands
helm-install:
	helm dependency update helm/crypto-portfolio
	helm install crypto-portfolio helm/crypto-portfolio -n $(NAMESPACE) --create-namespace

helm-upgrade:
	helm upgrade crypto-portfolio helm/crypto-portfolio -n $(NAMESPACE)

helm-uninstall:
	helm uninstall crypto-portfolio -n $(NAMESPACE)

# Skaffold commands
dev:
	skaffold dev --profile=dev

debug:
	skaffold debug --profile=dev

# Database migrations
migrate-up:
	yarn migration:run

migrate-down:
	yarn migration:revert

migrate-create:
	yarn migration:create $(name)

# Monitoring
logs:
	kubectl logs -f -l app=crypto-portfolio -n $(NAMESPACE) --tail=100

metrics:
	kubectl top pods -n $(NAMESPACE)
	kubectl top nodes

# Cleanup
clean:
	kubectl delete namespace $(NAMESPACE)
	docker-compose down -v
	docker system prune -f
```

### 8. GitHub Actions CI/CD

```yaml
# .github/workflows/deploy.yml
name: Deploy to Kubernetes

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: jbelanger/crypto-portfolio

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'yarn'

      - name: Install dependencies
        run: yarn install --frozen-lockfile

      - name: Run tests
        run: yarn test

      - name: Run E2E tests
        run: |
          docker-compose -f docker-compose.test.yml up -d
          yarn test:e2e
          docker-compose -f docker-compose.test.yml down

  build:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v2
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v4
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha

      - name: Build and push Docker image
        uses: docker/build-push-action@v4
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'

    steps:
      - uses: actions/checkout@v3

      - name: Setup kubectl
        uses: azure/setup-kubectl@v3
        with:
          version: 'latest'

      - name: Configure kubectl
        run: |
          echo "${{ secrets.KUBE_CONFIG }}" | base64 -d > kubeconfig
          echo "KUBECONFIG=$(pwd)/kubeconfig" >> $GITHUB_ENV

      - name: Deploy to Kubernetes
        run: |
          kubectl set image deployment/crypto-portfolio-app \
            app=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} \
            -n crypto-portfolio
          kubectl rollout status deployment/crypto-portfolio-app -n crypto-portfolio
```
