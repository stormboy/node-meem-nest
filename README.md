node-meem-nest
==============

A meem library for the Nest thermostat


You need a settings.json file with content like:

```javascript
{
        "mqttHost" : "192.168.0.100",
        "mqttPort" : 1883,
        "nestId"   : "XXXXXXXXXXXXXXXX",
        "username" : "test@example.com",
        "password" : "mypassword"
}
```

## To Do

Meemify with facets for
- current temp (output)
- current humidity (output)
- temperature set-point (input)