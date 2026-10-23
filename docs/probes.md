# What a Keelson probe does

Keelson watches MCP servers for changes. This page is for the people who run those servers and
want to know what the traffic in their logs is.

## What a probe does

A probe opens a normal MCP session with the server, reads what the server says it offers, and
closes the session. It asks for three lists and nothing else:

- the list of tools
- the list of prompts
- the list of resources

Keelson stores those lists so it can tell when something changes. It keeps the names,
descriptions and input schemas the server reports.

## What a probe never does

- It never calls a tool.
- It never runs a prompt.
- It never reads a resource.
- It never sends anything to your server beyond the session handshake and the three list requests.

So a probe cannot change anything on your server or trigger any action there.

## How often

Each monitor is probed at most once every 5 minutes. When someone first adds your server to
Keelson, one extra check is made straight away to confirm that the address is an MCP server.

A probe gives up after 10 seconds. The session identifies itself in the MCP handshake as
`keelson`.

## If a server sends a token

If the person who added your server gave Keelson a bearer token, it is sent in the
`Authorization` header of the probe. Without one, the probe is anonymous.

## How to reach the operator

If you want probes to stop, or something looks wrong, open an issue at
<https://github.com/DanielFidalgo/keelson/issues> and say which server address is affected.
Please do not put secrets or tokens in the issue.
