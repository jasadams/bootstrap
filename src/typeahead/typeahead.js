angular.module('ui.bootstrap.typeahead', ['ui.bootstrap.position'])

/**
 * A helper service that can parse typeahead's syntax (string provided by users)
 * Extracted to a separate service for ease of unit testing
 */
  .factory('typeaheadParser', ['$parse', function ($parse) {

  //                      00000111000000000000022200000000000000003333333333333330000000000044000
  var TYPEAHEAD_REGEXP = /^\s*(.*?)(?:\s+as\s+(.*?))?\s+for\s+(?:([\$\w][\$\w\d]*))\s+in\s+(.*)$/;

  return {
    parse:function (input) {

      var match = input.match(TYPEAHEAD_REGEXP), modelMapper, viewMapper, source;
      if (!match) {
        throw new Error(
          "Expected typeahead specification in form of '_modelValue_ (as _label_)? for _item_ in _collection_'" +
            " but got '" + input + "'.");
      }

      return {
        itemName:match[3],
        source:$parse(match[4]),
        viewMapper:$parse(match[2] || match[1]),
        modelMapper:$parse(match[1])
      };
    }
  };
}])

  .directive('typeahead', ['$compile', '$parse', '$q', '$document', '$position', 'typeaheadParser', function ($compile, $parse, $q, $document, $position, typeaheadParser) {

  var HOT_KEYS = [9, 13, 27, 38, 40];

  return {
    require:'ngModel',
    link:function (originalScope, element, attrs, modelCtrl) {

      var selected;

      //minimal no of characters that needs to be entered before typeahead kicks-in
      var minSearch = originalScope.$eval(attrs.typeaheadMinLength) || 1;

      //expressions used by typeahead
      var parserResult = typeaheadParser.parse(attrs.typeahead);

      //should it restrict model values to the ones selected from the popup only?
      var isEditable = originalScope.$eval(attrs.typeaheadEditable) !== false;

      var isLoadingSetter = $parse(attrs.typeaheadLoading).assign || angular.noop;


      var popupPlacementTop = false;
      attrs.$observe( 'typeaheadPlacement', function ( val ) {
         popupPlacementTop = angular.isDefined( val ) ? (val.toLowerCase() === 'top') : false;
      });

      //pop-up element used to display matches
      var popUpEl = angular.element(
        "<typeahead-popup " +
          "matches='matches' " +
          "active='activeIdx' " +
          "select='select(activeIdx)' "+
          "query='query' "+
          "position='position'>"+
        "</typeahead-popup>");

      //create a child scope for the typeahead directive so we are not polluting original scope
      //with typeahead-specific data (matches, query etc.)
      var scope = originalScope.$new();
      originalScope.$on('$destroy', function(){
        scope.$destroy();
      });

      var resetMatches = function() {
        scope.matches = [];
        scope.activeIdx = -1;
      };

      var getMatchesAsync = function(inputValue) {

        var locals = {$viewValue: inputValue};
        isLoadingSetter(originalScope, true);
        $q.when(parserResult.source(scope, locals)).then(function(matches) {

          //it might happen that several async queries were in progress if a user were typing fast
          //but we are interested only in responses that correspond to the current view value
          if (inputValue === modelCtrl.$viewValue) {
            if (matches.length > 0) {

              // First remove any items that are no longer in matches
              var i = scope.matches.length;
              while (i--) {
                var matched = false;
                for(var j=0; j<matches.length; j++) {
                  if (scope.matches[i].model === matches[j]) {
                    matched = true;
                    break;
                  }
                }
                // If not matched remove the item
                if (!matched) {
                  scope.matches.splice(i,1);
                }
              }
              //transform labels
              for(var k=0; k<matches.length; k++) {

                var matchedIndex = -1;
                for(var l=0; l<scope.matches.length; l++) {
                  if (scope.matches[l].model === matches[k]) {
                    matchedIndex = l;
                    break;
                  }
                }

                locals[parserResult.itemName] = matches[k];
                // If not matched remove the item
                if (matchedIndex >= 0) {
                  scope.matches[matchedIndex].label = parserResult.viewMapper(scope, locals);
                } else {
                  scope.matches.push({
                    label: parserResult.viewMapper(scope, locals),
                    model: matches[k]
                  });
                }
              }

              scope.query = inputValue;
              //position pop-up with matches - we need to re-calculate its position each time we are opening a window
              //with matches as a pop-up might be absolute-positioned and position of an input might have changed on a page
              //due to other elements being rendered
              var position = $position.position(element);
              scope.position = { left : position.left + 'px' };
              if (popupPlacementTop) {
                scope.position.bottom = element.prop('offsetHeight') + 'px';
                scope.activeIdx = scope.matches.length-1;
              } else {
                scope.position.top = position.top + element.prop('offsetHeight') + 'px';
                scope.activeIdx = 0;
              }
            } else {
              resetMatches();
            }
            isLoadingSetter(originalScope, false);
          }
        }, function(){
          resetMatches();
          isLoadingSetter(originalScope, false);
        });
      };

      resetMatches();

      //we need to propagate user's query so we can higlight matches
      scope.query = undefined;

      //plug into $parsers pipeline to open a typeahead on view changes initiated from DOM
      //$parsers kick-in on all the changes coming from the view as well as manually triggered by $setViewValue
      modelCtrl.$parsers.push(function (inputValue) {

        if (selected) {
          resetMatches();
          return inputValue;
        } else {
          if (inputValue && inputValue.length >= minSearch) {
            getMatchesAsync(inputValue);
          } else {
            resetMatches();
          }
        }

        return isEditable ? inputValue : undefined;
      });

      modelCtrl.$render = function () {
        var locals = {};
        locals[parserResult.itemName] = selected || modelCtrl.$viewValue;
        element.val(parserResult.viewMapper(scope, locals) || modelCtrl.$viewValue);
        selected = undefined;
      };

      scope.select = function (activeIdx) {
        //called from within the $digest() cycle
        var locals = {};
        locals[parserResult.itemName] = selected = scope.matches[activeIdx].model;

        modelCtrl.$setViewValue(parserResult.modelMapper(scope, locals));
        modelCtrl.$render();
      };

      //bind keyboard events: arrows up(38) / down(40), enter(13) and tab(9), esc(27)
      element.bind('keydown', function (evt) {

        //typeahead is open and an "interesting" key was pressed
        if (scope.matches.length === 0 || HOT_KEYS.indexOf(evt.which) === -1) {
          return;
        }

        evt.preventDefault();

        if (evt.which === 40) {
          scope.activeIdx = (scope.activeIdx + 1) % scope.matches.length;
          scope.$digest();

        } else if (evt.which === 38) {
          scope.activeIdx = (scope.activeIdx ? scope.activeIdx : scope.matches.length) - 1;
          scope.$digest();

        } else if (evt.which === 13 || evt.which === 9) {
          scope.$apply(function () {
            scope.select(scope.activeIdx);
          });

        } else if (evt.which === 27) {
          evt.stopPropagation();

          resetMatches();
          scope.$digest();
        }
      });

      $document.bind('click', function(){
        resetMatches();
        scope.$digest();
      });

      element.after($compile(popUpEl)(scope));
    }
  };

}])

  .directive('typeaheadPopup', function () {
    return {
      restrict:'E',
      scope:{
        matches:'=',
        query:'=',
        active:'=',
        position:'=',
        select:'&'
      },
      replace:true,
      templateUrl:'template/typeahead/typeahead.html',
      link:function (scope, element, attrs) {

        scope.isOpen = function () {
          return scope.matches.length > 0;
        };

        scope.isActive = function (matchIdx) {
          return scope.active == matchIdx;
        };

        scope.selectActive = function (matchIdx) {
          scope.active = matchIdx;
        };

        scope.selectMatch = function (activeIdx) {
          scope.select({activeIdx:activeIdx});
        };
      }
    };
  })

  .filter('typeaheadHighlight', function() {

    function escapeRegexp(queryToEscape) {
      return queryToEscape.replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1");
    }

    return function(matchItem, query) {
      return query ? matchItem.replace(new RegExp(escapeRegexp(query), 'gi'), '<strong>$&</strong>') : query;
    };
  });