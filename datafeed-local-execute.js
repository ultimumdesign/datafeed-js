const fs = require('fs')
const Runner = require('./datafeed-local')

Runner().controller()
  .then(data => {
    if (data) fs.writeFileSync('./datafeed-local-results.xml', data)
  }).catch(err => console.log(err))
