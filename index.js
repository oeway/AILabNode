#!/usr/bin/env node
const worker_version = '0.1';
const DDPClient = require("ddp");

const path = require('path');
const mkdirp = require('mkdirp');
const os = require('os');

const argv = require('yargs')
      .default({id : "",
                token : "",
                host: 'ai.pasteur.fr',
                port: 443,
                ssl: true,
                workdir: './dai-workdir',
                dropbox_token: null,
                debug: false,
                concurrency: 10,
                timeout: 10*24*60*60 //10 days maximum
               })
      .argv;

console.log(argv);

const worker_id=argv.id;
const worker_token=argv.token;
const host = argv.host;
const port = argv.port;
const ssl = argv.ssl;
const workdir= path.resolve(argv.workdir);
const debug = argv.debug;
const task_concurrency = argv.concurrency;
const task_timeout = argv.timeout; //10 days maximum
const dropbox_access_token = argv.dropbox_token;

const utils = require('./utils.js');

const Widgets = require('./widgets.js');
const widgets = Widgets.widgets;
const Widget = Widgets.Widget;

const Tasks = require('./tasks.js');
const tasks = Tasks.tasks;
const Task = Tasks.Task;
const task_queue = Tasks.task_queue;
task_queue.concurrency = task_concurrency;
task_queue.timeout = task_timeout;

let dropbox = undefined;
if(dropbox_access_token){
  const Dropbox = require('dropbox');
  dropbox = new Dropbox({ accessToken: dropbox_access_token });
  dropbox.uploadFile = (filePath, uploadPath, chunk_size)=>{
    return utils.dropbox_file_upload(dropbox, filePath, uploadPath, chunk_size);
  };
}

if(dropbox){
  utils.patchDropboxMethods(Task, dropbox);
}

mkdirp(workdir, (err)=>{
  if(err) console.error(err);
});

utils.load_cache(workdir);

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
      if (!wasReconnect) {
          /*
           * Observe collection widgets.
           */
          const observer_widgets = ddpclient.observe("widgets");
          observer_widgets.added = function(id) {
            console.log("[ADDED] to " + observer_widgets.name + ":  " + id);
            widgets[id] = new Widget(id, ddpclient, tasks, workdir);
          };
          observer_widgets.changed = function(id, oldFields, clearedFields, newFields) {
            console.log("[CHANGED] in " + observer_widgets.name + ":  " + id);
            //console.log("[CHANGED] old field values: ", oldFields);
            //console.log("[CHANGED] cleared fields: ", clearedFields);
            //console.log("[CHANGED] new fields: ", newFields);
            if('code_snippets' in newFields){
              widgets[id].register();
            }
          };
          observer_widgets.removed = function(id, oldValue) {
            console.log("[REMOVED] in " + observer_widgets.name + ":  " + id);
            if(id in widgets){
              for(id in tasks){
                  const task = tasks[id];
                  if(task.get('widgetId') == id){
                      try {
                          if(task.$ctrl.close){
                              task.$ctrl.close();
                          }
                      } catch (err) {
                          this.set('status.error', err.toString());
                      }
                      task.close();
                  }
              }
              delete widgets[id];
            }
            //console.log("[REMOVED] previous value: ", oldValue);
          };
      }
    if (!wasReconnect) {
       /*
       * Observe collection tasks.
       */
      const observer_tasks = ddpclient.observe("tasks");
      observer_tasks.added = function(id) {
        console.log("[ADDED] to " + observer_tasks.name + ":  " + id);
        if(id in tasks){
            const task = tasks[id];
            if(task.get('status.running')){
                task.set({ 'status.info': 'worker reconnected.'});
                task.widget_updated = true;
            }
            else{
                task.init();
            }
        }
        else{
            const t = ddpclient.collections.tasks[id];
            const task = new Task(id, ddpclient, widgets[t['widgetId']], workdir, worker_id, worker_token, dropbox);
            if(task.widget){
                tasks[id] = task;
                if(task.get('status.running')){
                  task.set({ 'status.error': 'worker restarted unexpectedly'});
                  task.close('aborted');
                }
                else if(task.get('cmd') && task.get('cmd') != ''){
                  task.init();
                  task.execute(task.get('cmd'));
                }
                else{
                  task.init();
                }
            }
            else{
                task.close('aborted');
                console.error('widget not found');
            }
        }
      };
      observer_tasks.changed = function(id, oldFields, clearedFields, newFields) {
        if(debug) console.log("[CHANGED] in " + observer_tasks.name + ":  " + id);
        //console.log("[CHANGED] old field values: ", oldFields);
        //console.log("[CHANGED] cleared fields: ", clearedFields);
        //console.log("[CHANGED] new fields: ", newFields);
        let task;
        if(id in tasks){
          task = tasks[id];
        }
        else{
          const t = ddpclient.collections.tasks[id];
          task = new Task(id, ddpclient, widgets[t['widgetId']], workdir, worker_id, worker_token, dropbox);
        }
        if('cmd' in newFields && newFields['cmd'] != ''){
          task.execute(newFields['cmd']);
        }
      };
      observer_tasks.removed = function(id, oldValue) {
        console.log("[REMOVED] in " + observer_tasks.name + ":  " + id);
        // console.log("[REMOVED] previous value: ", oldValue);
        if(id in tasks){
          try {
            if(tasks[id].$ctrl.close) tasks[id].$ctrl.close();
          } catch (e) {
              console.error(e);
          }
          delete tasks[id];
        }
      };
    }
  /*
   * Subscribe to a Meteor Collection
   */
  ddpclient.subscribe(
    'worker.widgets',                  // name of Meteor Publish function to subscribe to
    [worker_id, worker_token],         // any parameters used by the Publish function
    function () {             // callback when the subscription is complete
      console.log('worker.widgets subscribed.');
      //console.log(ddpclient.collections.workers);
      if(ddpclient.collections.workers && ddpclient.collections.workers[worker_id]){
        console.log('worker found: '+ ddpclient.collections.workers[worker_id].name);
        task_queue.autostart = true;
        if(wasReconnect){
            console.log("Resuming the task queue...")
            task_queue.start((err)=>{console.log('queue is empty or an error occured')});
        }
        worker_set({status:'ready', version: worker_version, name: os.hostname()+'('+worker_id.slice(0, 4)+')'});
        setInterval(function(){ worker_set({'resources.date_time':new Date().toLocaleString()}); }, 3000);

            //console.log(ddpclient.collections.widgets);
            ddpclient.subscribe(
              'tasks.worker',                  // name of Meteor Publish function to subscribe to
              [worker_id, worker_token],       // any parameters used by the Publish function
              function (error) {
                  if(error)
                    console.error(error);
                  else
                    console.log('tasks subscribed.');
                  //console.log(ddpclient.collections.tasks);
            });

      }
      else{
        console.log('ERROR: worker not found.')
        ddpclient.close();
      }
    }
  );

});

function worker_set(v){
  ddpclient.call('workers.update', [worker_id, worker_token, {'$set': v}], function (err, result) {
    if(err) console.error('worker update error:', err);
  });
}

// /*
//  * If you need to do something specific on close or errors.
//  * You can also disable autoReconnect and
//  * call ddpclient.connect() when you are ready to re-connect.
// */
ddpclient.on('socket-close', function(code, message) {
  console.log("Socket Close: %s %s", code, message);
  task_queue.stop();
  console.log("Task Queue stopped.")
});

ddpclient.on('socket-error', function(error) {
  console.log("Socket Error: %j", error);
  // task_queue.stop();
});

process.on('SIGINT', ()=>{
    console.log("interrupting...");
    utils.save_cache();
    worker_set({status:'exit'});
    process.exit();
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
