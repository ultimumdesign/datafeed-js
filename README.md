# DATAFEED-JS
Modular data feed javascript transporter

DATAFEED-JS is a JavaScript based module that serves [Archer](https://archer.example.com) as a data feed. It connects
to various data sources using https and JWT auth. It can also do limited processing (ie converting between data structures).

### Considerations for Usage

- In order to upload/configure datafeed.js as a data feed in Archer the following must be satisfied:

  1.  Archer by default requires that uploaded JavaScript files be digitally signed.
      > To turn this feature off use the Archer Control Panel:
      > Instance Settings > JavaScript Transporter > Require Signature
  2.  The data feed configuration must be configured with the following
      custom (case sensitive) Archer parameters:

      ```javascript
        {
            "baseUrl": "API base URL",
            "login": "",
            "password": ""
        }
      ```

TODO:

1. Tests
2. CI/CD