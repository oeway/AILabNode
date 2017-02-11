var DDPClient = require("ddp");
var queue = require('queue');
var child = require('child_process');

var worker_id='DqnzfdRssa7w68tPc',
    worker_token='E3nMrYYvezC',
    host = 'ai.pasteur.fr',
    port = 443,
    ssl = true;
var workdir='./dai-workdir';
var debug = false;

var q = queue();
q.autostart = true;
q.concurrency = 10;
q.timeout = 10*24*60*60; //10 days maximum

// use the timeout feature to deal with jobs that
// take too long or forget to execute a callback
q.on('timeout', function(next, job) {
  console.log('job timed out:', job.toString().replace(/\n/g, ''));
  next();
});
// get notified when jobs complete
q.on('success', function(result, job) {
  console.log('job finished processing:', job.toString().replace(/\n/g, ''));
});

var ddpclient = new DDPClient({
  // All properties optional, defaults shown
  host : host,
  port : port,
  ssl  : ssl,
  autoReconnect : true,
  autoReconnectTimer : 500,
  maintainCollections : true,
  ddpVersion : '1',  // ['1', 'pre2', 'pre1'] available
  // uses the SockJs protocol to create the connection
  // this still uses websockets, but allows to get the benefits
  // from projects like meteorhacks:cluster
  // (for load balancing and service discovery)
  // do not use `path` option when you are using useSockJs
  useSockJs: true,
  // Use a full url instead of a set of `host`, `port` and `ssl`
  // do not set `useSockJs` option if `url` is used
  // url: server_url
});
console.log('connecting...')
/*
 * Connect to the Meteor Server
 */
ddpclient.connect(function(error, wasReconnect) {
  // If autoReconnect is true, this callback will be invoked each time
  // a server connection is re-established
  if (error) {
    console.log('DDP connection error!');
    return;
  }

  if (wasReconnect) {
    console.log('Reestablishment of a connection.');
  }

  console.log('connected!');

  // setTimeout(function () {
  //   /*
  //    * Call a Meteor Method
  //    */
  //   ddpclient.call(
  //     'deletePosts',             // name of Meteor Method being called
  //     ['foo', 'bar'],            // parameters to send to Meteor Method
  //     function (err, result) {   // callback which returns the method call results
  //       console.log('called function, result: ' + result);
  //     },
  //     function () {              // callback which fires when server has finished
  //       console.log('updated');  // sending any updated documents as a result of
  //       console.log(ddpclient.collections.posts);  // calling this method
  //     }
  //   );
  // }, 3000);
var tasks = {}

function Task(id){
  this.id = id;
}
Task.prototype.update= function(v){
  ddpclient.call("tasks.update.worker", [this.id, worker_id, worker_token, v], function (err, result) {
    if(err) console.error('task update error:', err);
  });
}
Task.prototype.execute = function(cmd){
  if(cmd == 'run'){
    console.log(this.id);
    q.push((cb)=> {
        this.update({'status.running': true});
        var process = child.spawn('ps');
        process.stdout.on('data', (chunk)=>{
          console.log(chunk);
          this.update({'status.info': chunk});
        });
        process.stdout.on('end', ()=>{
          console.log('job ended');
          this.update({'status.running': false, visible2worker:false})
          cb();
        });
    });
  }
}

  /*
   * Subscribe to a Meteor Collection
   */
  ddpclient.subscribe(
    'workers.worker',                  // name of Meteor Publish function to subscribe to
    [worker_id, worker_token],                       // any parameters used by the Publish function
    function () {             // callback when the subscription is complete
      console.log('worker subscribed.');
      //console.log(ddpclient.collections.workers);
      if(ddpclient.collections.workers[worker_id]){
        console.log('worker found: '+ ddpclient.collections.workers[worker_id].name)
        ddpclient.subscribe(
          'widgets.worker',                  // name of Meteor Publish function to subscribe to
          [worker_id, worker_token],                       // any parameters used by the Publish function
          function (error) {
            console.log('widgets subscribed.');
            //console.log(ddpclient.collections.widgets);
        });
        ddpclient.subscribe(
          'tasks.worker',                  // name of Meteor Publish function to subscribe to
          [worker_id, worker_token],                       // any parameters used by the Publish function
          function (error) {
            console.log('tasks subscribed.');
            //console.log(ddpclient.collections.tasks);
        });
      }
      else{
        console.log('worker not found.')
        return;
      }
    }
  );

  /*
   * Observe collection widgets.
   */
  var observer_widgets = ddpclient.observe("widgets");
  observer_widgets.added = function(id) {
    console.log("[ADDED] to " + observer_widgets.name + ":  " + id);
  };
  observer_widgets.changed = function(id, oldFields, clearedFields, newFields) {
    console.log("[CHANGED] in " + observer_widgets.name + ":  " + id);
    //console.log("[CHANGED] old field values: ", oldFields);
    //console.log("[CHANGED] cleared fields: ", clearedFields);
    //console.log("[CHANGED] new fields: ", newFields);
  };
  observer_widgets.removed = function(id, oldValue) {
    console.log("[REMOVED] in " + observer_widgets.name + ":  " + id);
    //console.log("[REMOVED] previous value: ", oldValue);
  };
  /*
   * Observe collection tasks.
   */
  var observer_tasks = ddpclient.observe("tasks");
  observer_tasks.added = function(id) {
    console.log("[ADDED] to " + observer_tasks.name + ":  " + id);
    tasks[id] = new Task(id);
  };
  observer_tasks.changed = function(id, oldFields, clearedFields, newFields) {
    console.log("[CHANGED] in " + observer_tasks.name + ":  " + id);
    //console.log("[CHANGED] old field values: ", oldFields);
    //console.log("[CHANGED] cleared fields: ", clearedFields);
    //console.log("[CHANGED] new fields: ", newFields);
    if(id in tasks){
      var task = tasks[id];
    }
    else{
      var task = new Task(id);
    }
    if('cmd' in newFields){
      task.execute(newFields['cmd']);
    }
  };
  observer_tasks.removed = function(id, oldValue) {
    console.log("[REMOVED] in " + observer_tasks.name + ":  " + id);
    // console.log("[REMOVED] previous value: ", oldValue);
    if(id in tasks){
      delete tasks[id];
    }
  };

});

// /*
//  * If you need to do something specific on close or errors.
//  * You can also disable autoReconnect and
//  * call ddpclient.connect() when you are ready to re-connect.
// */
ddpclient.on('socket-close', function(code, message) {
  console.log("Close: %s %s", code, message);
});

ddpclient.on('socket-error', function(error) {
  console.log("Error: %j", error);
});

/*
 * Useful for debugging and learning the ddp protocol
 */
 if(debug){
   ddpclient.on('message', function (msg) {
     console.log("ddp message: " + msg);
   });
 }
/*
 * Close the ddp connection. This will close the socket, removing it
 * from the event-loop, allowing your application to terminate gracefully
 */
// ddpclient.close();
