$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskOutput = Join-Path $taskRoot 'infra/k8s/base'
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
$taskServices = @(
    @{ Name='core-finance'; Live='/actuator/health/liveness'; Ready='/actuator/health/readiness'; CPU='500m'; Memory='768Mi'; Limit='1536Mi' },
    @{ Name='capture-automation'; Live='/health/live'; Ready='/health/ready'; CPU='250m'; Memory='256Mi'; Limit='768Mi' },
    @{ Name='rates-realtime'; Live='/health/live'; Ready='/health/ready'; CPU='100m'; Memory='128Mi'; Limit='384Mi' },
    @{ Name='analytics'; Live='/health/live'; Ready='/health/ready'; CPU='250m'; Memory='384Mi'; Limit='1Gi' },
    @{ Name='notifications'; Live='/health/live'; Ready='/health/ready'; CPU='200m'; Memory='256Mi'; Limit='768Mi' }
)
foreach ($taskService in $taskServices) {
    $taskName = $taskService.Name
    $taskManifest = @"
apiVersion: v1
kind: ServiceAccount
metadata:
  name: $taskName
automountServiceAccountToken: false
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: $taskName
spec:
  replicas: 1
  selector:
    matchLabels: {app: $taskName}
  strategy:
    type: RollingUpdate
    rollingUpdate: {maxUnavailable: 0, maxSurge: 1}
  template:
    metadata:
      labels: {app: $taskName}
      annotations:
        linkerd.io/inject: enabled
    spec:
      serviceAccountName: $taskName
      terminationGracePeriodSeconds: 30
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        seccompProfile: {type: RuntimeDefault}
      containers:
        - name: application
          image: ledgerline/${taskName}:dev
          imagePullPolicy: IfNotPresent
          ports: [{name: http, containerPort: 8080}]
          envFrom:
            - secretRef: {name: ${taskName}-config}
          resources:
            requests: {cpu: $($taskService.CPU), memory: $($taskService.Memory)}
            limits: {cpu: '1', memory: $($taskService.Limit)}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: {drop: ['ALL']}
          volumeMounts: [{name: tmp, mountPath: /tmp}]
          startupProbe:
            httpGet: {path: $($taskService.Live), port: http}
            periodSeconds: 5
            failureThreshold: 36
          livenessProbe:
            httpGet: {path: $($taskService.Live), port: http}
            periodSeconds: 10
          readinessProbe:
            httpGet: {path: $($taskService.Ready), port: http}
            periodSeconds: 5
            timeoutSeconds: 3
      volumes: [{name: tmp, emptyDir: {}}]
---
apiVersion: v1
kind: Service
metadata:
  name: $taskName
spec:
  type: ClusterIP
  selector: {app: $taskName}
  ports: [{name: http, port: 8080, targetPort: http}]
"@
    Set-Content -LiteralPath (Join-Path $taskOutput "$taskName.yaml") -Value $taskManifest -Encoding utf8
}

