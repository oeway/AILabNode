const fs = require('fs');
const request = require('request');
const path = require('path');
const cache = require('memory-cache');

exports.load_cache = function(workdir){
  workdir = workdir || '';
  const cachejson = path.join(workdir, '__cache__.json');
  if(fs.existsSync(cachejson)){
      const json = JSON.parse(fs.readFileSync(cachejson, 'utf8'));
      if(json && json.downloaded_files){
        for(let i in json.downloaded_files){
          const f = json.downloaded_files[i];
          if(fs.existsSync(f.path)){
              console.log('put '+  path.basename(f.path) +' to cache')
            cache.put(f.url, f.path)
          }
        }
        console.log('cache loaded.')
      }
  }
}

exports.save_cache = function(workdir){
    workdir = workdir || '';
    const fileList = []
    const ks = cache.keys()
    for(let i in ks){
        if(fs.existsSync(cache.get(ks[i]))){
          fileList.push({url:ks[i], path:cache.get(ks[i])})
      }
    }
    const json = JSON.stringify({downloaded_files: fileList});
    fs.writeFileSync(path.join(workdir, '__cache__.json'), json, 'utf8')
}

exports.patchDropboxMethods = function(Task, dropbox){
    Task.prototype.saveDownloadUrl = function(url, file_path, allow_cache){
      if(!path.isAbsolute(file_path)){
          file_path = path.join(this.workdir, file_path);
      }
      const file_name = path.basename(file_path);
      return new Promise((resolve, reject)=>{
        // replace for dropbox
        url = url.split("?dl=0").join("?dl=1");
        Promise.all([
          dropbox.filesSaveUrl({path: this.dropboxPath + '/' + file_name, url:url}),
          this.downloadUrl(url, file_path, allow_cache)
        ]).then((result)=>{
          console.log(result);
          resolve(file_path);
        },(err)=>{
          reject(err);
        });
      });
    };
    Task.prototype.getSharedLink = function(short_url) {
      return new Promise((resolve, reject)=>{
        dropbox.sharingCreateSharedLink({path:this.dropboxPath, short_url:short_url}).then((link)=>{
          console.log(link.url);
          resolve(link);
        },(err)=>{
          reject(err);
        });
      });
    };
    Task.prototype.uploadFile= function(file_path, chunk_size, create_shared_link, short_url){
      if(!path.isAbsolute(file_path)){
          file_path = path.join(this.workdir, file_path);
      }
      const file_name = path.basename(file_path);
      const upload_file_path = this.dropboxPath + '/' + file_name;
      create_shared_link = create_shared_link || true;
      short_url = short_url || false;
      return new Promise((resolve, reject)=>{
        dropbox.filesGetMetadata({path: this.dropboxPath, include_media_info: false, include_deleted: false})
        .then((response)=>{
            dropbox.uploadFile(file_path, upload_file_path, chunk_size).then(
              (file_meta_data)=>{
                console.log('file uploaded:', file_meta_data);
                if(create_shared_link){
                  dropbox.sharingCreateSharedLink({path:file_meta_data.path_lower, short_url:short_url}).then((link)=>{
                    console.log(link.url);
                    resolve(link);
                  },(err)=>{
                    reject(err);
                  });
                }
                else{
                  resolve(file_meta_data);
                }
              },
              (error)=>{
                reject(error);
              }
            );
        })
        .catch((error)=>{
            dropbox.filesCreateFolder({path: this.dropboxPath})
            .then((response)=>{
               dropbox.uploadFile(file_path, upload_file_path, chunk_size).then(
                 (file_meta_data)=>{
                   resolve(file_meta_data);
                 },
                 (error)=>{
                   reject(error);
                 }
               );
            })
            .catch((error)=>{
              	reject(error);
		console.log(error);
            });
        });
      });
    };
}

const download = function(url, dest, allow_cache, cb) {
    allow_cache = allow_cache || true;
    // timout = timout || 36000000;
    if(allow_cache){
      const k = cache.get(url);
      if(k && fs.existsSync(k)) return k;
    }
    cache.del(url);
    console.log('downloading ', url);
    var sendReq = request.get(url);
    var file = fs.createWriteStream(dest);


    // verify response code
    sendReq.on('response', function(response) {
        if (response.statusCode !== 200) {
            return cb('Response status was ' + response.statusCode);
        }
    });

    // check for request errors
    sendReq.on('error', function (err) {
        fs.unlink(dest);
        return cb(err.message);
    });

    sendReq.pipe(file);

    file.on('finish', function() {
        file.close(cb);  // close() is async, call cb after close completes.
        cache.put(url, dest);
    });

    file.on('error', function(err) { // Handle errors
        fs.unlink(dest); // Delete the file async. (But we don't check the result)
        return cb(err.message);
    });
    return null;
};
const dropbox_file_upload = function(dropbox, filePath, uploadPath, chunk_size) {
  chunk_size = chunk_size || 10 * 1024 * 1024; // 10MB
  const buffer = new Buffer(chunk_size);
  return new Promise(function(resolve, reject) {
    fs.open(filePath, 'r', function(err, fd) {
      if (err) throw err;
      function readNextChunk(upload_cursor) {
        fs.read(fd, buffer, 0, chunk_size, null, function(err, nread) {
          console.log('read chunk.');
          if (err) throw err;

          if (nread === 0) {
            // done reading file, do any necessary finalization steps
            dropbox.filesUploadSessionFinish({
                cursor: upload_cursor,
                commit: {
                            path: uploadPath,
                            mode: "overwrite",
                            autorename: true,
                            mute: false
                }
            }).then((file_meta_data)=>{
                console.log('upload finished:');
                // console.log(file_meta_data);
                resolve(file_meta_data);
            }).catch((err)=>{
                console.error('upload failed');
                // console.error(err);
                reject(err);
            });

            fs.close(fd, function(err) {
              if (err) throw err;
            });
            return;
          }

          var data;
          if (nread < chunk_size)
            data = buffer.slice(0, nread);
          else
            data = buffer;

          if(!upload_cursor){
            if(nread < chunk_size){
                dropbox.filesUpload({
                    contents:data,
                    path: uploadPath,
                    mode: "overwrite",
                    autorename: true,
                    mute: false
                }).then((file_meta_data)=>{
                    console.log('upload finished:');
                    //console.log(file_meta_data);
                    resolve(file_meta_data);
                }).catch((err)=>{
                    console.error('upload failed');
                    //console.error(err);
                    reject(err);
                });
            }
            else{
                dropbox.filesUploadSessionStart({contents: data, close: false}).then((cursor)=>{
                    console.log('upload started.');
                    upload_cursor = {session_id: cursor.session_id, offset: nread}
                    readNextChunk(upload_cursor);
                }).catch((err)=>{
                      console.error(err);
                  });
            }
          }
          else{
              dropbox.filesUploadSessionAppendV2({
                  contents:data,
                  cursor: upload_cursor,
                  close:false
              }).then(()=>{
                  console.log('uploading chunk.');
                  const new_upload_cursor = {
                      session_id: upload_cursor.session_id,
                      offset: upload_cursor.offset+nread
                  };
                  readNextChunk(new_upload_cursor);
              }).catch((err)=>{
                  console.error(err);
              });
          }
        });
      }
      readNextChunk();
    });
  });
};

exports.download = download;
exports.dropbox_file_upload = dropbox_file_upload;
