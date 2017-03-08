const path = require('path');
const mkdirp = require('mkdirp');
const fs = require('fs');
const child_process = require('child_process');
const vm = require('vm');
const queue = require('queue');

const Widget = require('./widgets.js').Widget;
const tasks = {};

const task_queue = queue();
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

class Task{
  constructor(id, ddpclient, widget, workdir, worker_id, worker_token, dropbox){
      this.id = id;
      this.widget = widget;
      this.ddpclient = ddpclient;
      this.process = null;
      this.worker_id = worker_id;
      this.worker_token = worker_token;
      this.workdir = path.join(workdir, 'widget-' + this.get('widgetId'), 'task-'+this.id);
      if(dropbox) this.dropboxPath = '/widget-' + this.get('widgetId') + '/task-'+ this.id;
      mkdirp(this.workdir, function(err) {
        if(err) console.error(err);
      });
      this.default_ctrl = {
        widget: this.widget,
        task: this,
        run: null,
        stop: null,
        init: null,
        close: null,
        open: ()=>{}
      };
      this.$ctrl = Object.assign({}, this.default_ctrl);
      this.default_context = {
       Buffer: Buffer,
       console: console,
       setTimeout: setTimeout,
       setInterval: setInterval,
       require: require,
       process: process,
        // TODO: remove all these default modules
       fs: fs,
       path: path,
       mkdirp: mkdirp,
       dropbox: dropbox,
       child_process: child_process,
      }
      this.context = Object.assign({}, this.default_context);
      this.context.$ctrl = this.$ctrl;

      this.widget_updated = false;
    }
    setWorker(v){
      this.ddpclient.call('workers.update', [this.worker_id, this.worker_token, {'$set': v}], function (err, result) {
        if(err) console.error('worker update error:', err);
      });
    }
   get(key){
      try{
        const keys = key.split('.');
        let v = this.ddpclient.collections.tasks[this.id];
        for(let i in keys){
          v = v[keys[i]];
        }
        return v;
      }
      catch(e){
        return undefined;
      }
    }
    set(key, value){
      let doc = {};
      if(typeof key == 'object'){
        doc = key;
      }
      else{
        doc[key] = value
      }
      this.ddpclient.call("tasks.update.worker", [this.id, this.worker_id, this.worker_token, {'$set': doc}], function (err, result) {
        if(err) console.error('task set error:', err);
      });
    }
    push(key, value){
      let doc = {};
      if(typeof key == 'object'){
        doc = key;
      }
      else{
        doc[key] = value
      }
      this.ddpclient.call("tasks.update.worker", [this.id, this.worker_id, this.worker_token, {'$push': doc}], function (err, result) {
        if(err) console.error('task push error:', err);
      });
    }
    pull(key, value){
      let doc = {};
      if(typeof key == 'object'){
        doc = key;
      }
      else{
        doc[key] = value
      }
      this.ddpclient.call("tasks.update.worker", [this.id, this.worker_id, this.worker_token, {'$pull': doc}], function (err, result) {
        if(err) console.error('task pull error:', err);
      });
    }
    addToSet(key, value){
      let doc = {};
      if(typeof key == 'object'){
        doc = key;
      }
      else{
        doc[key] = value
      }
      this.ddpclient.call("tasks.update.worker", [this.id, this.worker_id, this.worker_token, {'$addToSet': doc}], function (err, result) {
        if(err) console.error('task addToSet error:', err);
      });
    }
    downloadUrl(url, file_path, allow_cache) {
      allow_cache = allow_cache || false;
      if(!path.isAbsolute(file_path)){
          file_path = path.join(this.workdir, file_path);
      }
      // replace for dropbox
      url = url.split("?dl=0").join("?dl=1");
      return new Promise((resolve, reject)=>{
        utils.download(url, file_path, allow_cache, resolve);
      });
    }
    getWidgetCode (name){
      return this.widget.getCode(name);
    }
    init (){
        try {
          this.set({'status.error':'', 'status.info': ''});
          const timeout = this.widget.get('timeout') || 60000;
          const code_snippets = this.widget.get('code_snippets');
          const script = new vm.Script(code_snippets['WORKER_js'].content, {
            filename: code_snippets['WORKER_js'].name, // filename for stack traces
            lineOffset: 0, // line number offset to be used for stack traces
            columnOffset: 0, // column number offset to be used for stack traces
            displayErrors: true,
            timeout: timeout // ms
          });
          //reset $ctrl and context
          try {
              if(this.$ctrl.close){
                  this.$ctrl.close();
              }
              if(this.$ctrl.queue_callback){
                  this.$ctrl.queue_callback();
              }
          } catch (err) {
              this.set('status.error', err.toString());
          }
          this.$ctrl = Object.assign({}, this.default_ctrl);
          this.context = Object.assign({}, this.default_context);
          this.context.$ctrl = this.$ctrl;
          script.runInNewContext(this.context, {timeout: timeout});
          this.set({'status.stage':'attached', 'status.info':'','status.error':''});
          try {
              if(this.$ctrl.init){
                  this.$ctrl.init();
              }
          } catch (err) {
              this.set('status.error', err.toString());
          }
          console.log('task script updated:', this.id);
        } catch (e) {
          console.error(e);
          this.set('status.error', e.toString());
        }
    }
    stop (msg){
      const m = {'status.running': false};
      if(!msg || msg.endsWith('ing')){
          msg = 'stopped'
      }
      m['status.stage'] = msg;
      this.set(m);
      try {
          if(this.$ctrl.stop){
              this.$ctrl.stop();
          }
      } catch (e) {
          console.error(e);
      }
      if(this.widget_updated){
        this.widget_updated = false;
        this.init();
      }
    }
    close(msg){
      if(this.get('status.running')){
        this.stop('abort');
      }
      const m = {'isOpen': false};
      if(!msg || msg.endsWith('ing')){
          msg = 'exited'
      }
      m['status.stage'] =  msg;
      this.set(m);
    }
    execute(cmd){
      try {
          cmd = cmd || this.get('cmd');
          if(cmd == 'init'){
            this.init();
          }
          else if(cmd == 'run' && !this.get('status.running')){
            if(this.$ctrl.run){
              task_queue.push((cb)=>{
                this.$ctrl.queue_callback = cb;
                const done = (msg)=>{cb(); this.$ctrl.queue_callback=null; this.stop(msg); this.close(msg);};
                try {
                this.set({'status.running': true, 'status.stage': 'running', 'status.error':'', 'status.info':''});
                this.$ctrl.run(done);
                if(this.$ctrl.process){
                    this.$ctrl.process.on('close', (code) => {
                        done();
                        const msg = code==0 ? 'done': 'exited('+code+')';
                        this.close(msg);
                        delete this.$ctrl.process;
                    });
                    this.$ctrl.process.on('error', (err)=>{
                        console.error(err);
                        this.set('status.error', err.toString());
                    });
                }
                else{
                    console.log('WARNING: no $ctrl.process returned, please call done() when finished.');
                    // done();
                    // this.close();
                }
                if(!this.$ctrl.stop){
                    this.$ctrl.stop = ()=>{ if(this.$ctrl.process){ this.$ctrl.process.kill();} };
                }
              } catch (e) {
                console.error(e);
                this.set('status.error', e.toString());
                done();
              }});
              this.setWorker({'resources.queue_length': task_queue.length});
            }
            else{
              this.set('status.error', '"$ctrl.run" is not defined.');
            }
          }
          else if(cmd == 'stop'){
            if(this.$ctrl.stop){
              this.$ctrl.stop();
            }
            else{
              this.set('status.info', '"$ctrl.stop" is not defined.');
            }
            this.stop('aborted');
          }
          else if(cmd == 'close'){
            if(this.$ctrl.close){
              this.$ctrl.close();
            }
            if(this.$ctrl.queue_callback){
              this.$ctrl.queue_callback();
            }
          }
          else{
            if(this.$ctrl[cmd]){
              this.$ctrl[cmd]();
            }
            else{
              this.set('status.info', '"$ctrl.'+cmd+'" is not defined.');
            }
          }
      } catch (e) {
          console.error(e);
          this.set('status.error', e.toString());
      } finally {
          this.set({'cmd': ''});
      }
    }
}

exports.Task = Task;
exports.tasks = tasks;
exports.task_queue = task_queue;
