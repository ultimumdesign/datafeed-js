// APPROVED LIBRARY REFERENCES
// --All other libraries are blocked during sandboxed code execution.
// --For more details, visit https://www.npmjs.com/ and search for the library name.
const httpRequest = require('request')
const parser = require('xml2js')

// REQUIRED PARAMETERS
// An object with keys that describe the required process context parameters for options/execution
// this is passed into the execution scope from the Archer process
const requiredParams = {

}

// CUSTOM PARAMETERS
// --This object contains the custom parameters entered in the Custom Parameters section of the Transport tab of the data feed.
// --To access a parameter later in the script, use the following formats:
// --    Normal Text:    params.parameterName      Example: params.username or params.password
// --    Special Chars:  params["parameterName"]   Example: params["u$ername"] or params["pa$$word"]
// eslint-disable-next-line no-undef
const params = context.CustomParameters

// DATA FEED TOKENS
// --This object contains the data feed tokens set by the system. Examples: LastRunTime, LastFileProcessed, PreviousRunContext, etc..
// --NOTE: The tokens are READ ONLY by this script, save for the "PreviousRunContext" token, which is discussed later.
// --To access a token later in the script, use the following format:
// --    tokens.tokenName    Example: tokens.PreviousRunContext or tokens.LastRunTime
// var tokens = context.Tokens;

function validateEnv () {

}
/**
 * Retreives a specific options object with optional overwrite
 * @param {String} key The key representing the desired options to retrieve
 * @param {Object} [override={}] An optional object to override the default option selected
 */
function initOptions (key, override = {}) {
  const defaultOptions = {
    getS3: {
      method: 'GET',
      rejectUnauthorized: false
    },
    getHttps: {
      method: 'GET',
      secureProtocol: 'TLSv1_2_method',
      passphrase: params.passphrase
    },
    buildXml: {
      headless: true,
      rootName: 'RECORD',
      renderOpts: {
        pretty: true,
        indent: '    ',
        newline: '\n'
      }
    }
  }
  const selectedOption = Object.assign({}, defaultOptions[key])
  return Object.assign(selectedOption, override)
}

/**
 * Converts json data to an xml output
 * @param {String} jsonData JSON array of records to convert
 */
// eslint-disable-next-line no-unused-vars
function jsonArrayToXmlBuffer (jsonData, rootElement = null) {
  const responseBuilder = new parser.Builder(initOptions('buildXml'))
  const dataObject = JSON.parse(jsonData)
  const jsData = rootElement
    ? dataObject[rootElement]
    : dataObject
  const xmlBufferArray = jsData.reduce((preVal, curVal, i, src) => {
    preVal.push(Buffer.from(responseBuilder.buildObject(curVal), 'utf8'))
    if (i + 1 === src.length) preVal.push(Buffer.from('</DATA>', 'utf8'))
    return preVal
  }, [Buffer.from('<DATA>', 'utf8')])
  return Buffer.concat(xmlBufferArray)
}

/**
 *
 * @param {Object} options
 * @param {Boolean} [chunked=false]
 */
function requestEndpoint (options, chunked = false) {
  return new Promise((resolve, reject) => {
    if (chunked) {
      const req = httpRequest(options)
      req.on('response', response => {
        const data = []
        response.on('data', chunk => {
          data.push(chunk)
        })
        response.on('end', () => {
          const output = `${data.join('')}`
          resolve(output)
        })
      })
      req.on('error', error => {
        reject(error)
      })
    } else {
      httpRequest(options, (error, response, body) => {
        if (error) reject(error)
        if (response) resolve(body)
      })
    }
  })
}

/**
 * Retrieves all the required files for TLS
 * @returns {Object}
 */
function getTlsContext () {
  // get all certs as promises
  const certFile = requestEndpoint(initOptions('getS3', {
    url: params.certURI }), false)
  const keyFile = requestEndpoint(initOptions('getS3', {
    url: params.keyURI }), false)
  const caFile = requestEndpoint(initOptions('getS3', {
    url: params.caURI }), false)
  // once all certs are returned
  return Promise.all([certFile, keyFile, caFile]).then(values => {
    return {
      cert: values[0],
      key: values[1],
      ca: values[2]
    }
  })
}

/**
 * Final processing function
 * @param {*} data Data to finalize and send to Archer
 */
function execute (error = null, data) {
  // callback() is a parent process global function
  // eslint-disable-next-line no-undef
  if (error) callback(error)
  // eslint-disable-next-line no-undef
  callback(null, {
    // Return the data to RSA Archer
    output: Buffer.from(data),
    // PreviousRunContext token value; 256 char limit. If omitted, the token is cleared.
    previousRunContext: 'myContextVariable'
  })
}

/**
 * Primary execution function
 */
async function runFeed (debug = false) {
  try {
    const tlsObject = await getTlsContext()
    let token = ''
    if (params.authURI) {
      const authReply = await requestEndpoint(
        initOptions(
          'getHttps',
          Object.assign({ url: params.authURI }, tlsObject)
        )
      )
      const bodyObject = JSON.parse(authReply)
      token = bodyObject.token
    }
    // variable processing depends on params.scriptType
    const scriptType = params.scriptType
      ? Number.parseInt(params.scriptType)
      : 0
    switch (scriptType) {
      // no auth, non-chunked reply
      case 0:
        const data = await requestEndpoint(
          initOptions(
            'getHttps',
            Object.assign({ url: params.dataURI }, tlsObject)
          )
        )
        execute(data)
        break
      // no auth, chunked reply
      case 1:
        const data1 = await requestEndpoint(
          initOptions(
            'getHttps',
            Object.assign({ url: params.dataURI }, tlsObject)
          ),
          true
        )
        execute(data1)
        break
      // JWT auth, non-chunked reply
      case 2:
        const data2 = await requestEndpoint(
          initOptions(
            'getHttps',
            Object.assign({
              url: params.dataURI,
              headers: { authorization: `bearer ${token}` }
            }, tlsObject)
          )
        )
        execute(data2)
        break
      // JWT auth, chunked reply
      case 3:
        const data3 = await requestEndpoint(
          initOptions(
            'getHttps',
            Object.assign({
              url: params.dataURI,
              headers: { authorization: `bearer ${token}` }
            }, tlsObject)
          ),
          true
        )
        execute(data3)
        break
      // JSON input with XML conversion, no auth, non-chunked reply
      case 4:
        const data4 = await requestEndpoint(
          initOptions(
            'getHttps',
            Object.assign({ url: params.dataURI }, tlsObject)
          )
        )
        const data4Xml = jsonArrayToXml(data4)
        execute(data4Xml)
        break
      // JSON input with XML conversion, no auth, chunked reply
      case 5:
        const data5 = await requestEndpoint(
          initOptions(
            'getHttps',
            Object.assign({ url: params.dataURI }, tlsObject)
          ),
          true
        )
        const data5Xml = jsonArrayToXml(data5)
        execute(data5Xml)
        break
      // JSON input with XML conversion, JWT auth, non-chunked reply
      case 6:
        const data6 = await requestEndpoint(
          initOptions(
            'getHttps',
            Object.assign({
              url: params.dataURI,
              headers: { authorization: `bearer ${token}` }
            }, tlsObject)
          )
        )
        const data6Xml = jsonArrayToXml(data6)
        execute(data6Xml)
        break
      // JSON input with XML conversion, JWT auth, chunked reply
      case 7:
        const data7 = await requestEndpoint(
          initOptions(
            'getHttps',
            Object.assign({
              url: params.dataURI,
              headers: { authorization: `bearer ${token}` }
            }, tlsObject)
          ),
          true
        )
        const data7Xml = jsonArrayToXml(data7)
        execute(data7Xml)
    }
  } catch (e) {
    throw e
  }
}

runFeed((params.debug || false))

module.exports = runFeed
