var OAuth = require('oauth').OAuth;
var config = require('./config');

var oauth = new OAuth(
  config.request_token_url,
  config.access_token_url,
  config.consumer_key,
  config.consumer_secret,
  config.oauth_version,
  config.oauth_callback,
  config.oauth_signature
);


module.exports = {
  get : function(url , access_token , access_token_secret , cb){
    oauth.get.call(oauth , url , access_token , access_token_secret , cb);
  },
  post : function(url , access_token , access_token_secret , body , cb){
    oauth.post.call(oauth , url , access_token , access_token_secret , body , cb);

  },
    redirectToTwitterLoginPage : function(req, res){
      //ask for a request token
      oauth.getOAuthRequestToken(function(error , oauth_token,
      oauth_token_secret, results){
        if (error){
          console.log(error);
          res.send('Authentication failed!');
        } else {
            //if Authentication was good on the first phase we use
            //request token to take client to twitter login
            res.cookie('oauth_token' , oauth_token , {httponly : true});
            res.cookie('oauth_token_secret' , oauth_token_secret , {httponly : true});
            res.redirect(config.authorize_url + '?oauth_token=' + oauth_token);
          }
      });
  },

  authenticate : function(req , res , cb) {
    if (!(req.cookies.oauth_token &&
          req.cookies.oauth_token_secret &&
          req.query.oauth_verifier)){
            return cb('request does not have all required keys');
          }
          //clear token cookies
          res.clearCookie('oauth_token');
          res.clearCookie('oauth_token_secret');
          //cb();

          //Exchange temporary credentials for access tokens
          oauth.getOAuthAccessToken(
            req.cookies.oauth_token,
            req.cookies.oauth_token_secret,
            req.query.oauth_verifier,
            function(error,
              oauth_access_token,
              oauth_access_token_secret, results){
                    if (error) {
                      return cb(error);
                    }
                    //get the clients twiiter ID
                  oauth.get('https://api.twitter.com/1.1/account/verify_credentials.json', oauth_access_token,
                  oauth_access_token_secret,
                  function(error,data){
                    if (error){
                      console.log(error);
                      return cb(error);
                    }
                  //parse the data
                  data = JSON.parse(data);
                  //store the tokens and Twitter ID in cookies
                  res.cookie('access_token' , oauth_access_token , {httponly : true});
                  res.cookie('access_token_secret' , oauth_access_token_secret , {httponly : true});
                  res.cookie('twitter_id' , data.id_str , {httponly : true});
                  //tell router we are successful
                  cb();
                });
              });
            }
          };
