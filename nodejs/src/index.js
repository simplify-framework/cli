var AWS = require('aws-sdk')
var cloudwatchlogs = new AWS.CloudWatchLogs();

module.exports.handler = function(event, context, callback) {
    function getContentBody(dataContent) {
        return {
            statusCode: 200,
            body: JSON.stringify({ "content": dataContent }),
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, PATCH",
                "Access-Control-Allow-Headers": "X-Requested-With,content-type"
            }
        }
    }
    if (event.path == '/content' && event.httpMethod == "GET") {
        cloudwatchlogs.filterLogEvents({
            logGroupName: process.env.LOG_GROUP_NAME,
            startTime: new Date().getTime() - 600,
            endTime: new Date().getTime()
        }, function(err, data) {
          if (err) callback(null, getContentBody(""))
          else {
             if (data.searchedLogStreams.length) {
                data.searchedLogStreams.map(logStream => {
                    cloudwatchlogs.getLogEvents({
                        logGroupName: process.env.LOG_GROUP_NAME,
                        logStreamName: data.searchedLogStreams[0].logStreamName
                    }, function(err, data) {
                        if (err) callback(null, getContentBody(""))
                        else {
                            var dataContent = data.events.map(d => `<div>${new Date(d.timestamp).toISOString()} - ${d.message}</div>`).join('\n')
                            callback(null, getContentBody(dataContent))
                        }
                    })
                })
             }
          }
        });
    } else {
        callback({ "message": "Incorrect!" })
    }
}