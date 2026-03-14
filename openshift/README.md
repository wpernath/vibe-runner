# Deploy Running Out on OpenShift

## Prerequisites

- `oc` CLI logged into your OpenShift cluster
- Docker image available (e.g. from GitHub Container Registry or built locally)

## Option 1: Deploy with image from registry

1. Create a new project (or use existing):

   ```bash
   oc new-project runningout
   ```

2. Create an image pull secret if your image is private (e.g. GHCR):

   ```bash
   oc create secret docker-registry ghcr-secret \
     --docker-server=ghcr.io \
     --docker-username=YOUR_GITHUB_USER \
     --docker-password=YOUR_PAT
   oc secrets link default ghcr-secret --for=pull
   ```

3. Edit `deployment.yaml` and set `spec.template.spec.containers[0].image` to your image, e.g.:

   ```yaml
   image: ghcr.io/your-org/runningout:latest
   ```

4. Apply the manifests:

   ```bash
   oc apply -f openshift/deployment.yaml
   ```

5. Get the route URL:

   ```bash
   oc get route runningout
   ```

   Open the shown hostname in a browser (use `https://` and accept the default cert if needed).

## Option 2: Build in OpenShift (BuildConfig)

To build the image inside OpenShift from source:

```bash
oc new-project runningout
oc new-app https://github.com/YOUR_ORG/runningout --strategy=docker
# Wait for build to complete, then create route or use oc expose
oc expose svc/runningout
```

## Option 3: Local build and push to OpenShift internal registry

```bash
docker build -t runningout:latest .
docker tag runningout:latest image-registry.openshift-image-registry.svc:5000/runningout/runningout:latest
oc whoami -t | docker login -u unused --password-stdin image-registry.openshift-image-registry.svc:5000
docker push image-registry.openshift-image-registry.svc:5000/runningout/runningout:latest
# Then apply deployment with that image
oc apply -f openshift/deployment.yaml
```

## Image requirements (already met)

- Listens on **port 8080** (OpenShift default)
- Runs as **non-root** user (nginx unprivileged)
- **/health** endpoint for probes
