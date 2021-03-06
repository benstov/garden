[![CircleCI](https://circleci.com/gh/garden-io/garden/tree/master.svg?style=svg&circle-token=ac1ec9984d093f91e594e5a0a03b34cec2c2a093)](https://circleci.com/gh/garden-io/garden/tree/master)

<p align="center">
  <img src="docs/logo.png" width="50%">
</p>

Garden is a _development orchestrator_ for Kubernetes, containers and functions, designed to make it easy to rapidly develop and test multi-service systems.

Using Garden, you can make your workflow reproducible and portable. With Garden, each part of your stack _describes itself_ using simple, intuitive declarations, without changing any code.

Garden collects all of your declarations—even across multiple repositories—into a full graph of your stack, and leverages that information to **dramatically improve your developer experience**.

> _If you’re using Garden or if you like the project, please ★ star this repository to show your support 💖_

## Key features

- Spin up your whole stack with a single command, and (optionally) watch for changes. Because of the dependency graph, only what's needed gets re-built, re-deployed, and/or re-tested, so you get **much faster feedback loops**.
- Easily write [integration test suites](https://docs.garden.io/using-garden/features-and-usage#testing-and-dependencies) that have runtime dependencies. Run tests before pushing your code to CI, and avoid having to mock or stub your own services.
- Define [tasks](https://github.com/garden-io/garden/tree/master/examples/tasks) that run as part of your deployment process, e.g. database migrations or scaffolding.
- [Hot reload](https://docs.garden.io/using-garden/hot-reload) lets you near-instantaneously update code and static files in containers as they run, for services that support in-place reloading.
- [Remote sources](https://docs.garden.io/examples/remote-sources) support allows your project to automatically pull code from different repositories.
- The built-in web **dashboard** gives you a full overview of your stack (and many more UI features are planned to further aid with development).
- Build, test and deploy Docker containers, [Helm charts](https://docs.garden.io/using-garden/using-helm-charts), OpenFaaS functions and more.
- An extensible plug-in system ensures you'll later be able add anything that's not on this list, or create custom module types tailored to your needs (_due in March 2019_).

_Note: The project is in alpha stage. APIs may change, and some features are still experimental._

<p align="center">
  <img src="docs/loop.gif" width="75%">
</p>

## Quick start

Head over to the [Basics](https://docs.garden.io/basics) section in our documentation for details
on how to set up and use Garden, or look through our [Simple Project](https://docs.garden.io/examples/simple-project)
guide to get a quick sense of how it works.

## Documentation

You can find the full Garden documentation at [https://docs.garden.io](https://docs.garden.io/).

Overview:

- [Basics](https://docs.garden.io/basics), for installation instructions, our quick start guide, and an overview of the main concepts around Garden.
- [Using Garden](https://docs.garden.io/using-garden), for features and usage, Garden configuration files, usage with remote clusters, and setting up hot reload.
- [Example Projects](https://docs.garden.io/examples) contains guides based on some of the [examples](https://github.com/garden-io/garden/tree/v0.9.3/examples).
- [Reference](https://docs.garden.io/reference), for the glossary, commands reference, configuration files reference, and template strings reference.
- [FAQs](https://docs.garden.io/faqs).

## Examples

There are examples of how to use Garden in a myriad of different ways in the [examples](https://github.com/garden-io/garden/tree/v0.9.3/examples) folder of our repository.

For written guides based on some of these examples, check out the [examples section](https://docs.garden.io/examples) of our documentation.

Here are some simple examples of how Garden configuration files look:

```yaml
kind: Module
type: helm
name: redis
description: Redis service for message queueing
chart: stable/redis
```

```yaml
kind: Module
type: openfaas
name: hello-function
description: My OpenFaaS function
lang: node
```

```yaml
kind: Module
type: container
name: go-service
description: Go service container
services:
- name: go-service
  ports:
    - name: http
      containerPort: 80
  ingresses:
    - path: /hello-go
      port: http
tests:
- name: integ
  command: [./test]
  dependencies: [my-other-service]
```

Please browse our [examples directory](https://github.com/garden-io/garden/tree/v0.9.3/examples) for full project configurations and further context.

## Support

Please join the Garden [Slack workspace](http://chat.garden.io) to ask questions, discuss how Garden might fit into your workflow, or even just chat about all things DevOps.

## Acknowledgements

Garden would not be possible without an amazing ecosystem of open-source projects. Here are just some of the projects that Garden uses, either directly or indirectly:

- [Kubernetes](https://kubernetes.io/)
- [OpenFaaS](https://www.openfaas.com/)
- [TypeScript](https://www.typescriptlang.org/)
- [Golang](https://golang.org/)
- [Moby](https://github.com/moby/moby)
- [Helm](https://helm.sh/)

Garden, as a company, is also a proud member of the [CNCF](https://www.cncf.io/).

## License

Garden is licensed according to [Mozilla Public License 2.0 (MPL-2.0)](LICENSE.md).
