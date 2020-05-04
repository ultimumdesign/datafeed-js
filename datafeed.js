/* eslint-disable no-useless-catch */
// APPROVED LIBRARY REFERENCES
// --All other libraries are blocked during sandboxed code execution.
// --For more details, visit https://www.npmjs.com/ and search for the library name.
const httpRequest = require('request')
const parser = require('xml2js')

// REQUIRED PARAMETERS
// An object in which the keys describe the required process context parameters for options/execution
// this is passed into the execution scope from the Archer datafeed config
const requiredParams = {
  username: 'username of account',
  password: 'password to splunk',
  baseUrl: 'base url of api',
  source: 'which dashboard query'
}

// CUSTOM PARAMETERS
// --This object contains the custom parameters entered in the Custom Parameters section of the Transport tab of the data feed.
// --To access a parameter later in the script, use the following formats:
// --    Normal Text:    params.parameterName      Example: params.username or params.password
// --    Special Chars:  params["parameterName"]   Example: params["u$ername"] or params["pa$$word"]
// eslint-disable-next-line no-undef
const params = context.CustomParameters
const auth = Buffer.from(`${params.username}:${params.password}`).toString('base64')

// OUTPUT WRITER
// Archer added a convenience function attached to the context global that enables looping
// writes to the file system this next statement creates an instance of the write and contains
// a method .writeItem(item)
// eslint-disable-next-line no-undef
const outputWriter = context.OutputWriter.create('XML', { RootNode: 'DATA' })
const waitFor = ms => new Promise(resolve => setTimeout(resolve, ms))

// DATA FEED TOKENS
// --This object contains the data feed tokens set by the system. Examples: LastRunTime, LastFileProcessed, PreviousRunContext, etc..
// --NOTE: The tokens are READ ONLY by this script, save for the "PreviousRunContext" token, which is discussed later.
// --To access a token later in the script, use the following format:
// --    tokens.tokenName    Example: tokens.PreviousRunContext or tokens.LastRunTime
// var tokens = context.Tokens;

/**
 * Retreives a specific options object with optional overwrite
 * @param {String} key The key representing the desired options to retrieve
 * @param {Object} [override={}] An optional object to unpack over the default option selected
 */
function initOptions (key, override = {}) {
  const defaultOptions = {
    // default xml builder opts
    buildXml: {
      headless: true,
      rootName: 'RECORD',
      renderOpts: {
        pretty: true,
        indent: '  ',
        newline: '\n'
      }
    },
    // data endpoint
    search: {
      method: 'POST',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}:8089/services/search/jobs/`,
      rejectUnauthorized: false,
      headers: {
        Authorization: `Basic ${auth}`
      },
      form: {
        search: null,
        earliest: params.earliest || '-7d'
      }
    },
    // data endpoint
    results: {
      method: 'GET',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}:8089/services/search/jobs/{{sid}}/results`,
      json: true,
      rejectUnauthorized: false,
      headers: {
        Authorization: `Basic ${auth}`
      },
      form: {
        output_mode: 'json'
      }
    },
    // data endpoint
    status: {
      method: 'GET',
      secureProtocol: 'TLSv1_2_method',
      url: `${params.baseUrl}:8089/services/search/jobs/{{sid}}`,
      json: true,
      rejectUnauthorized: false,
      headers: {
        Authorization: `Basic ${auth}`
      },
      form: {
        output_mode: 'json'
      }
    },
    acctMgtOverTime: {
      query: '| `tstats` count from datamodel=Change.All_Changes where nodename=All_Changes.Account_Management    by _time,All_Changes.action span=10m | timechart minspan=10m useother=`useother` count by All_Changes.action | `drop_dm_object_name("All_Changes")`'
    },
    acctLockouts: {
      query: '| tstats `summariesonly` count from datamodel=Change.All_Changes where nodename=All_Changes.Account_Management All_Changes.result="lockout"    by All_Changes.src,All_Changes.Account_Management.src_nt_domain,All_Changes.user | sort 100 - count | `drop_dm_object_name("All_Changes")` |  `drop_dm_object_name("Account_Management")`'
    },
    acctMgtByUser: {
      query: '| tstats `summariesonly` count from datamodel=Change.All_Changes where nodename=All_Changes.Account_Management    by All_Changes.Account_Management.src_user| `drop_dm_object_name("All_Changes")` | `drop_dm_object_name("Account_Management")` | sort 10 - count'
    },
    acctMgtEvents: {
      query: '| tstats `summariesonly` count from datamodel=Change.All_Changes where nodename=All_Changes.Account_Management    by _time,All_Changes.action span=1h | `drop_dm_object_name("All_Changes")` | stats sparkline(sum(count),1h) as sparkline,sum(count) as count by action | sort 10 - count'
    },
    notableIncRespEvents: {
      query: `index=notable 
      | stats sparkline as Frequency count by search_name 
      | sort -count`
    },
    uniqueAuth: {
      query: `index=windows EventCode=4625 OR (EventCode=4624 AND Logon_Type=3) NOT (host=A-Server-1 OR host=A-Server-2 OR host=N3B-DC1-MERRICK OR host=n3b-dc2) user!=*$ user!=-
      | dedup user
      |eval EventCode=if(EventCode=4624, "Successful", EventCode)
      |eval EventCode=if(EventCode=4625, "Failed", EventCode)
      | timechart count by EventCode
      `
    },
    firewallEventsBlocked: {
      query: `index=* sourcetype="cisco:sourcefire" OR sourcetype="cisco:asa" AND action=Block* OR vendor_action=Block*
      | rename vendor_action as action
      | eval action=if(action="Block,", "Block", action)
      | eval action=if(action="blocked", "Block", action)
      | where isnotnull(action)
      | timechart count by action
      | appendpipe [stats count | where count=0]`
    },
    firewallEventsAllowed: {
      query: `index=* sourcetype="cisco:sourcefire" OR sourcetype="cisco:asa" AND action=Allow* OR vendor_action=Allow*
      | rename vendor_action as action
      | eval action=if(action="Allow,", "Allow", action)
      | eval action=if(action="allowed", "Allow", action)
      | where isnotnull(action)
      | timechart count by action
      | appendpipe [stats count | where count=0]`
    },
    networkOverview: {
      query: `index=* (sourcetype="cisco:asa" OR sourcetype="cisco:pix" OR sourcetype="cisco:fwsm" OR sourcetype="cisco:sourcefire")  AND (vendor_action=Block* OR vendor_action=Allow* OR action=Allow* OR action=Block* OR action=Redirect OR action=failure)
      | rename vendor_action as action
      | eval action=if(action="Allow,", "Allow", action)
      | eval action=if(action="allowed", "Allow", action)
      | eval action=if(action="Block,", "Block", action)
      | eval action=if(action="blocked", "Block", action)
      | where isnotnull(action)
      | timechart count by action
      | appendpipe [stats count | where count=0]`
    },
    securityServicesDisabled: {
      query: `index=windows sourcetype=winhostmon eventtype=securityservices State="Stopped" host=* DisplayName="*" NOT (DisplayName="Windows Defender*" AND host=dt-n3b-fc* OR dest=*IT*
      OR dest=*cc3d*
      OR dest=*dev*
      OR dest=Gold-N3B-FullClone-1803 
      OR dest=*FA*
      OR dest=*FT*)
      |stats values(DisplayName) AS DisplayName first(State) as CurrentState first(_time) as _time by host
      |mvexpand DisplayName
      |table _time host DisplayName CurrentState`
    },
    topServices: {
      query: `index=* sourcetype="cisco:*" OR sourcetype="eStreamer" dest_ip!="255.255.255.255" dest_ip!="0.0.0.0" 
      | eval port=coalesce(dest_port,src_port)
      | where isnotnull(port) 
      | lookup networkservice "Port Number" as port OUTPUT "Service Name" AS service 
      | eval service=if(isnull(service),"Port:"+tostring(port),service) 
      | top service`
    },
    topSourcesByCountry: {
      query: `index=* sourcetype="cisco:*" OR sourcetype="eStreamer" dest_ip!="255.255.255.255" dest_ip!="0.0.0.0" src_ip="*" 
      |iplocation src_ip
      |top Country
      `
    },
    topDestination: {
      query: `index=* sourcetype="cisco:*" OR sourcetype="eStreamer" dest_ip="*" dest_ip!="255.255.255.255" dest_ip!="0.0.0.0" 
      | rename dest_ip as clientip 
      | top clientip  
      | lookup dnslookup clientip
      | eval clienthost=if(isnull(clienthost), clientip, clienthost)
      | eval clienthost=if(clienthost==clientip, "Lookup-NotFound", clienthost)
      | eval clientip=clientip+": "+clienthost`
    },
    topSources: {
      query: `index=* sourcetype="cisco:*" OR sourcetype="eStreamer" dest_ip!="255.255.255.255" dest_ip!="0.0.0.0" src_ip=* sourcetype!="cisco:ise:syslog"
      | rename src_ip as clientip 
      | top clientip  
      | lookup dnslookup clientip
      | eval clienthost=if(isnull(clienthost), clientip, clienthost)
      | eval clienthost=if(clienthost==clientip, "Lookup-NotFound", clienthost)
      | eval clientip=clientip+": "+clienthost`
    },
    nacAuthFailures: {
      query: `index=cisco_ise host=n3b-ise-* sourcetype=cisco:ise:syslog action=failure 
      | stats  count(Calling_Station_ID) as count values(UserName) as UserName values(NetworkDeviceName) as Source values(NAS_Port_Id) as SourcePort values(FailureReason) as Failure values(ISEPolicySetName) as ISE_Policy last(_time) as Time by  Calling_Station_ID
      | eval Time=strftime(Time, "%H:%M:%S %m-%d-%y") 
      | table Time Calling_Station_ID UserName Source SourcePort Failure ISE_Policy count
      | sort -count
      `
    }
  }
  const selectedOption = Object.assign({}, defaultOptions[key])
  return Object.assign(selectedOption, override)
}

/**
 * Promise wrapper for request library
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
          const body = data.join('')
          resolve({ body, response })
        })
      })
      req.on('error', error => {
        reject(error)
      })
    } else {
      httpRequest(options, (error, response, body) => {
        if (error) reject(error)
        if (response) resolve({ body, response })
      })
    }
  })
}

/**
 * Retry wrapper for requestEndpoint
 * @param {*} opts pass through options object for request
 * @param {*} retriesLeft retry max count
 * @param {*} interval retry interval in ms
 */
/* eslint-disable-next-line no-unused-vars */
function retryEndpoint (opts, retriesLeft = 10, interval = 2500) {
  return new Promise((resolve, reject) => {
    requestEndpoint(opts)
      .then(resolve)
      .catch((error) => {
        setTimeout(() => {
          if (retriesLeft === 1) {
            // reject('maximum retries exceeded');
            reject(error)
            return
          }
          // Passing on "reject" is the important part
          retryEndpoint(opts, retriesLeft - 1).then(resolve, reject)
        }, interval)
      })
  })
}

/**
 * Runner factory
 */
function Runner () {
  return {
    /**
     * Primary execution controller
     */
    async controller () {
      try {
        this.validateEnv()
        const sid = await this.postSearch()
        await this.getStatus(sid)
        await this.getResults(sid)
      } catch (err) {
        throw err
      }
    },
    /**
     * Performs search on splunk
     * @returns {String} SID for search job
     */
    async postSearch () {
      try {
        const searchOptions = initOptions('search')
        const { query } = initOptions(params.source)
        searchOptions.form.search = query
        const { body } = await requestEndpoint(searchOptions)
        let parsed = null
        parser.parseString(body, function (err, result) {
          if (err) throw err
          parsed = result
        })
        if (!parsed.response.sid) throw new Error('Unable to parse search response')
        return parsed.response.sid[0]
      } catch (err) {
        throw err
      }
    },
    /**
     * Gets a job search results
     * @param {String} sid SID of search job to get results for
     */
    async getResults (sid) {
      try {
        const resultsOptions = initOptions('results')
        resultsOptions.url = resultsOptions.url.replace('{{sid}}', sid)
        const { body } = await requestEndpoint(resultsOptions)
        this.write(body.results)
      } catch (err) {
        throw err
      }
    },
    /**
     * Gets a job search status
     * @param {String} sid SID of search job to get status for
     */
    async getStatus (sid) {
      try {
        const statusOptions = initOptions('status')
        statusOptions.url = statusOptions.url.replace('{{sid}}', sid)
        const waitInterval = params.wait || 5000
        let done = false
        let attemptsRemaining = 5
        while (done === false) {
          try {
            await waitFor(waitInterval)
            const { body } = await requestEndpoint(statusOptions)
            if (body.entry.content.isDone === true) { done = true }
            attemptsRemaining -= 1
            if (attemptsRemaining === 0) throw new Error('Unable to get status before limit')
          } catch (innerError) {
            attemptsRemaining -= 1
            if (attemptsRemaining === 0) throw innerError
          }
        }
        return done
      } catch (err) {
        throw err
      }
    },
    /**
     * Validates requiredParams object against the process environment variables.
     */
    validateEnv () {
      Object.keys(requiredParams).forEach(val => {
        if (!params[val]) {
          throw new Error(`Required param validation failed. 
        Please check the file against the datafeed config`)
        }
      })
    },
    /**
     * Writes data depends on params.print
     * @param {Array} list an array of data to write
     */
    write (list) {
      const responseBuilder = new parser.Builder(initOptions('buildXml'))
      list.forEach(item => {
        outputWriter.writeItem(responseBuilder.buildObject(item))
      })
    }
  }
}

Runner().controller().then(() => {
  // eslint-disable-next-line no-undef
  callback(null, { previousRunContext: params.source })
}).catch(err => {
  // eslint-disable-next-line no-undef
  callback(null, { output: `${err}` })
})

module.exports = Runner
