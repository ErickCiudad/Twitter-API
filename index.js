var config = require('./config');
var storage = require('./storage.js')
var authenticator = require('./authenticator');
var bodyParser = require('body-parser');
var querystring = require('querystring');
var asynch = require('async');
var MongoClient = require('mongodb').MongoClient;
var url = require('url');
var express = require('express');
var hostname = "localhost";
var app = express();

//connect to MongoDb
storage.connect();

//Set the view engine ejs
app.set('view engine' , 'ejs')

//add cookie parsing ability to our appa
app.use(require('cookie-parser')());


app.use(bodyParser.json());


//clear cache on timed intervals
setInterval(function() {
    console.log('clearing mongoDB cache');
    if (storage.connected()) {
      storage.deleteFriends();
    }
}, 1000 * 60 *5);//1000 a second times 60, a minute times 5, for 5 minutes

app.get('/auth/twitter' , authenticator.redirectToTwitterLoginPage);

app.get(url.parse(config.oauth_callback).path , function(req , res) {
  authenticator.authenticate(req , res, function(err){
    if (err) {
      console.log(err);
      res.redirect('/login');
    } else {
      res.redirect('/')
    }
  })
})

app.get('/tweet' , function(req , res){
  if (!req.cookies.access_token || !req.cookies.access_token_secret) {
    return res.sendStatus(401);
  }
  //tweet
  authenticator.post('https://api.twitter.com/1.1/statuses/update.json' ,
                      req.cookies.access_token ,
                      req.cookies.access_token_secret,
                    {
                      status : "hmmm"
                    },
                  function(error , data){
                    if (error){
                      return res.status(400).send(error);
                    }
                    res.send('Tweet successful!');
          });
});

//search
app.get('/search' , function(req , res){
  if (!req.cookies.access_token ||
      !req.cookies.access_token_secret) {
        return res.sendStatus(401);
  }

  authenticator.get('https://api.twitter.com/1.1/search/tweets.json?' + querystring.stringify({q: "'hmmm"}),
  req.cookies.access_token ,
  req.cookies.access_token_secret,
  function(error , data){
    if (error){
      return res.status(400).send(error);
    }
    res.send(data);
  });
});

app.get('/friends', function(req,res) {
  if (!req.cookies.access_token ||
      !req.cookies.access_token_secret) {
        return res.sendStatus(401);
  }
  var url = 'https://api.twitter.com/1.1/friends/list.json';
  if (req.query.cursor) {
  url += '?' + querystring.stringify({ cursor : req.query.cursor})
  }
  authenticator.get(url, req.cookies.access_token,
  req.cookies.access_token_secret, function(error, data) {
    if (error){
      return res.status(400).send(error);
    }
    res.send(data);
  });
});

app.get('/', function(req, res) {
  if (!req.cookies.access_token ||
      !req.cookies.access_token_secret || !req.cookies.twitter_id) {
        return res.redirect('/login');
  }
  if (!storage.connected()) {
    console.log('Going to load friends from Twitter');
    return renderMainPageFromTwitter(req, res);
  }

  //get data from MongoDbB
  console.log('Going to load data from MongoDB');
  storage.getFriends(req.cookies.twitter_id, function(err, friends){
    if (err) {
    return res.status(500).send(err)//chained together
    }
    if (friends.length > 0) {
      console.log('Friends loaded from MongoDB');

      // Sort the friends alphabetically by name
      friends.sort(function(a, b) {
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase)
      });
      //render the index.ejs page
      res.render('index' , {
        friends: friends
      });
    }

    else {
        console.log('Data loaded from Twiter');
        renderMainPageFromTwitter(req, res);
    }

  });
});

function renderMainPageFromTwitter(req, res) {
  asynch.waterfall([
      // get the friends id_str
      function(cb) {
        var cursor = -1;
        var ids = [];
        console.log(' 1) ids[] length:' + " " + ids.length);
        //get IDs by traversing cursored collection
        asynch.whilst(function(){
          return cursor != 0;
        }, function(cb) {

          authenticator.get('https://api.twitter.com/1.1/friends/ids.json?' + querystring.stringify({user_id : req.cookies.twitter_id, cursor : cursor}), req.cookies.access_token ,
            req.cookies.access_token_secret, function(error, data) {
              if (error){
                return res.status(400).send(error);
              }
              data = JSON.parse(data);
              cursor = data.next_cursor_str;
              ids = ids.concat(data.ids);
              cb();
            });
          }, function(error) {
              if (error) {
                return res.status(500).send(error);
              }
              cb(null, ids);
            });
      },
      // get the friends data using the IDs
      function(ids, cb) {
        console.log('2) ids[] length:' + " " + ids.length);
        // res.send(ids); old way of checking

        //returns 100 IDs starting from 100*i
        var getHundredthIds = function(i) {
          return ids.slice(100*i, Math.min(ids.length, 100*(i+1)));
        }
        var requestsNeeded = Math.ceil(ids.length/100);

        asynch.times(requestsNeeded, function (n, next) {
          var url =
          'https://api.twitter.com/1.1/users/lookup.json?' + querystring.stringify({user_id: getHundredthIds(n).join(',')});

          authenticator.get(url,
          req.cookies.access_token,
        req.cookies.access_token_secret,
      function(error, data){
        if(error) {
          return res.status(400).send(error);
}
        var friends = JSON.parse(data);
        next(null, friends);
      });
    },
    function(err, friends) {
      //flatten friends array
      friends = friends.reduce(function(previousValue, currentValue, currentIndex, array) {
        return previousValue.concat(currentValue);
      }, []);
      //sort the friends alphabetically by name
      friends.sort(function(a,b) {
        return
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      });

      //transform data to effiicient for our MongoDB
      friends = friends.map(function(friend) {
          return {
            twitter_id : friend.id_str,
            for_user : req.cookies.twitter_id,
            name: friend.name,
            screen_name: friend.screen_name,
            location: friend.location,
            profile_image_url: friend.profile_image_url
            // we don't need the rest of this junk
          }
      });

      res.render('index', {friends: friends
      });

      //Asynchronously save the friends to MongoDB
      if (storage.connected()) {
        storage.insertFriends(friends);
      }
      });
    }
  ]);
}

app.get('/login', function(req, res){
  console.log('Deleting friends collection on logout');
  if (storage.connected()) {
    storage.deleteFriends();
  }
  res.render('login');
})

app.get('/logout', function(req, res){
  //clear session cookies
  res.clearCookie('access_token');
  res.clearCookie('access_token_secret');
  res.clearCookie('twiiter_id');
  //clear MongoDB friends cache
  console.log('Deleting friends collection on logout');
  if (storage.connected()) {
    storage.deleteFriends();
  }
  res.render('login');
});

function ensureLoggedIn(req, res, next){
  if (!req.cookies.access_token ||
      !req.cookies.access_token_secret || !req.cookies.twitter_id) {
        return res.sendStatus(401);
  }
  next();
}

app.get('/friends/:uid/notes', ensureLoggedIn, function(req, res, next) {
  storage.getNotes(req.cookies.twitter_id, req.params.uid, function(err, notes){
    if (err) {
      return res.status(500).send(error);
    }
    res.send(notes);
  });
});

app.post('/friends/:uid/notes', ensureLoggedIn, function(req, res, next){
  storage.insertNote(req.cookies.twitter_id, req.params.uid, req.body.content, function(err, note){
    if (err) {
      return res.status(500).send(error);
    }
    res.send(note)
  });
})

app.put('/friends/:uid/notes/:noteid', ensureLoggedIn, function(req, res) {
  var noteId = req.params.noteid;
  storage.updateNote(req.params.noteid, req.cookies.twitter_id, req.body.content, function(err, note){
    if (err){
      return res.status(500).send(error);
    }
    res.send({
      _id: note._id,
      content: note.content
    });
  });
});

app.delete('/friends/:uid/notes/:noteid', ensureLoggedIn, function(req, res){
  var noteId = req.params.noteid;
  storage.deleteNote(req.params.noteid, req.cookies.twitter_id, function(err, note){
    if (err){
      return res.status(500).send(error);
    }
    res.sendStatus(200);
  });
});

//serve static files from public directory
app.use(express.static(__dirname + '/public'));

app.listen(config.port, function(){
  console.log(`Server is running on ${hostname}:${config.port}`);
  console.log('Oauth callback: ' +
      url.parse(config.oauth_callback).hostname +
      url.parse(config.oauth_callback).path
    )
});
