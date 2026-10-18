# Local runtime and Kubernetes architecture

The complete local stack is defined in ../compose.yaml. Start it with ../scripts/local-up.ps1. Docker Desktop Kubernetes (kind provisioner) runs the application through ../scripts/kubernetes-up.ps1; five domain pods each have an OpenTelemetry sidecar. Gateway/web, Fluent Bit and kube-state-metrics run in the same local namespace. Databases and central monitoring remain shared Compose infrastructure. Both modes have real runtime verification scripts; see ../docs/observability.md.

The base below remains a separate production architecture foundation. Use infra/k8s/local for the verified local deployment.

Run `./scripts/render-kubernetes.ps1`, then `kubectl kustomize infra/k8s/base` to inspect manifests. Five Deployments and private Services preserve the five application boundaries. Each has its own secret, probes, resource budgets, non-root security and temporary storage. Linkerd injection requests a proxy container when the mesh is installed.

This base is **not yet a complete deployable stack**. Docker/cluster, the five databases, OIDC issuer, own-service secrets, built images, Linkerd/CNI, gateway, Kafka/CDC, operators, production overlays and observability remain Phase 1/3/9 deliverables. Do not apply this base to a production cluster or claim functioning multi-container pods before those prerequisites are verified. No credentials are committed.

Secret names are `core-finance-config`, `capture-automation-config`, `rates-realtime-config`, `analytics-config`, `notifications-config`. Only that service's environment/credentials belong in its secret. See services/README.md for variable names. No public application ingress exists yet. Cluster DNS will resolve each `<service>.ledgerline.svc.cluster.local` once deployed.
