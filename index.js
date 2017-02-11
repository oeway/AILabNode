const DDPClient = require("ddp");
const queue = require('queue');
const child_process = require('child_process');
const vm = require('vm');
const path = require('path');
const mkdirp = require('mkdirp');
const os = require('os');

const worker_id='DqnzfdRssa7w68tPc',
    worker_token='E3nMrYYvezC',
    host = 'ai.pasteur.fr',
    port = 443,
    ssl = true;
const workdir='./dai-workdir';
const debug = false;
const worker_version = '0.1'

const task_queue = queue();
task_queue.concurrency = 10;
task_queue.timeout = 10*24*60*60; //10 days maximum

// use the timeout feature to deal with tasks that
// take too long or forget to execute a callback
task_queue.on('timeout', function(next, task) {
  console.log('task timed out:', task.toString().replace(/\n/g, ''));
  next();
});
// get notified when tasks complete
task_queue.on('success', function(result, task) {
  console.log('task finished.');
  // console.log('task finished processing:', task.toString().replace(/\n/g, ''));
});

const ddpclient = new DDPClient({
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
function worker_set(v){
  ddpclient.call('workers.update', [worker_id, worker_token, {'$set': v}], function (err, result) {
    if(err) console.error('worker update error:', err);
  });
}
const tasks = {}
function Task(id){
  this.id = id;
  this.workdir = path.join(workdir, 'widget-'+this.get_widget('_id'), 'task-'+this.id);
  const $ctrl = {
    task: this,
    child_process: child_process,
  };
  const context = {
   console: console,
   setTimeout: setTimeout,
   $ctrl: $ctrl
  }
  this.context = context;
  this.end = this.quit;
  // this.quit_timer = setTimeout(()=>{ console.log('time out'); this.quit();}, 30000);
}
Task.prototype.get = function(k){
  return ddpclient.collections.tasks[this.id][k];
}
Task.prototype.set= function(v){
  ddpclient.call("tasks.update.worker", [this.id, worker_id, worker_token, {'$set': v}], function (err, result) {
    if(err) console.error('task set error:', err);
  });
}
Task.prototype.push= function(v){
  ddpclient.call("tasks.update.worker", [this.id, worker_id, worker_token, {'$push': v}], function (err, result) {
    if(err) console.error('task push error:', err);
  });
}
Task.prototype.pull= function(v){
  ddpclient.call("tasks.update.worker", [this.id, worker_id, worker_token, {'$pull': v}], function (err, result) {
    if(err) console.error('task pull error:', err);
  });
}
Task.prototype.addToSet= function(v){
  ddpclient.call("tasks.update.worker", [this.id, worker_id, worker_token, {'$addToSet': v}], function (err, result) {
    if(err) console.error('task addToSet error:', err);
  });
}
Task.prototype.get_widget = function(key){
  const wid = ddpclient.collections.tasks[this.id]['widgetId'];
  if(key){
    return ddpclient.collections.widgets[wid][key];
  }
  return ddpclient.collections.widgets[wid];
}
Task.prototype.init = function(process){
  mkdirp(this.workdir, function(err) {
    if(err) console.error(err);
  });
  process.stderr.on('data', (data) => {
    console.error('stderr: ' + data.toString());
    this.set({'status.error': data.toString()});
  });
  process.on('close', (code) => {
    console.log('exited with code: ' + code);
    this.end('exited:' + code);
  });
  this.process = process;
  this.set({'status.stage':'init', 'status.info':'','status.error':'', 'status.running': true});
}
Task.prototype.quit = function(msg){
  const m = {'status.running': false, 'status.waiting':false, visible2worker:false};
  m['status.stage'] = msg || 'exited';
  this.set(m);
}
Task.prototype.execute = function(cmd){
  if(cmd == 'run'){
    this.set({'status.waiting': true});
    task_queue.push((cb)=> {
      // overide end()
      this.end = (status)=>{
        this.quit(status);
        cb();
      }
      this.set({'status.waiting': false});
      try {
        const code_snippets = this.get_widget('code_snippets');
        if('worker_js' in code_snippets){
          vm.runInNewContext(code_snippets['worker_js'].content, this.context);
        }
        else{
          console.log('worker.js not found.');
          this.set({'status.info': 'worker.js not found.'});
        }
      } catch (e) {
        console.error(e);
        this.set({'status.error': e.toString()});
        this.end();
      }
    });
  }
  else if(cmd == 'stop'){
    if(this.process) this.process.kill();
  }
  this.set({'cmd': ''});
  // clearTimeout(this.quit_timer);
}

  /*
   * Subscribe to a Meteor Collection
   */
  ddpclient.subscribe(
    'workers.worker',                  // name of Meteor Publish function to subscribe to
    [worker_id, worker_token],         // any parameters used by the Publish function
    function () {             // callback when the subscription is complete
      console.log('worker subscribed.');
      //console.log(ddpclient.collections.workers);
      if(ddpclient.collections.workers[worker_id]){
        console.log('worker found: '+ ddpclient.collections.workers[worker_id].name)
        ddpclient.subscribe(
          'widgets.worker',                  // name of Meteor Publish function to subscribe to
          [worker_id, worker_token],         // any parameters used by the Publish function
          function (error) {
            console.log('widgets subscribed.');
            //console.log(ddpclient.collections.widgets);
        });
        ddpclient.subscribe(
          'tasks.worker',                  // name of Meteor Publish function to subscribe to
          [worker_id, worker_token],       // any parameters used by the Publish function
          function (error) {
            console.log('tasks subscribed.');
            task_queue.autostart = true;
            worker_set({status:'ready', version: worker_version, name: os.platform()});
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
  const observer_widgets = ddpclient.observe("widgets");
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
  const observer_tasks = ddpclient.observe("tasks");
  observer_tasks.added = function(id) {
    console.log("[ADDED] to " + observer_tasks.name + ":  " + id);
    const task = new Task(id);
    tasks[id] = task;
    if(task.get('cmd')){
      task.execute(task.get('cmd'));
    }
  };
  observer_tasks.changed = function(id, oldFields, clearedFields, newFields) {
    console.log("[CHANGED] in " + observer_tasks.name + ":  " + id);
    //console.log("[CHANGED] old field values: ", oldFields);
    //console.log("[CHANGED] cleared fields: ", clearedFields);
    //console.log("[CHANGED] new fields: ", newFields);
    let task;
    if(id in tasks){
      task = tasks[id];
    }
    else{
      task = new Task(id);
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
  worker_set({status:'close'});
});

ddpclient.on('socket-error', function(error) {
  console.log("Error: %j", error);
  worker_set({status:'error'});
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
