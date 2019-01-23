/**
 * Copyright 2018 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {ENDPOINTS} from './constants';
import {TwoStepsResponse} from './link-rewriter/two-steps-response';
import {deepEquals} from '../../../src/json';


export class Linkmate {
  /**
   * @param {!../../../src/service/ampdoc-impl.AmpDoc} ampDoc
   * @param {!../../../src/service/xhr-impl.Xhr} xhr
   * @param {?Object} linkmateOptions
   */
  constructor(ampDoc, xhr, linkmateOptions) {
    /** @private {!../../../src/service/ampdoc-impl.AmpDoc} */
    this.ampDoc_ = ampDoc;

    /** @private {!../../../src/service/xhr-impl.Xhr} */
    this.xhr_ = xhr;

    /** @private {?boolean} */
    this.requestExclusiveLinks_ = linkmateOptions.exclusiveLinks;

    /** @private {?int} */
    this.publisherID_ = linkmateOptions.publisherID;

    /** @private {?string} */
    this.linkAttribute_ = linkmateOptions.linkAttribute;

    /** @private {!Document|!ShadowRoot} */
    this.rootNode_ = this.ampDoc_.getRootNode();

    /** @private {!Array<!HTMLElement>} */
    this.anchorList_ = null;

    /** @private {?Array<JsonObject>}*/
    this.linkmateResponse_ = null;
  }

  /**
   * Callback used by LinkRewriter. Whenever there is a change in the anchors
   * on the page we want make a new API call.
   * @param {!Array<!HTMLElement>} anchorList
   * @return {!./link-rewriter/two-steps-response.TwoStepsResponse}
   * @public
   */
  runLinkmate(anchorList) {
    // If we already have an API response and the anchor list has
    // changed since last API call then map any new anchors to existing
    // API response
    let syncMappedLinks = null;
    if (this.linkmateResponse_ && this.anchorList_ &&
      !deepEquals(this.anchorList_, anchorList)) {
      syncMappedLinks = this.mapLinks_();
    }

    // If we don't have an API response or the anchor list has changed since
    // last API call then build a new payload and post to API
    if (!this.linkmateResponse_ ||
      (this.anchorList_ && !deepEquals(this.anchorList_, anchorList))) {

      const asyncMappedLinks = this.postToLinkmate_(anchorList)
          .then(res => {
            this.linkmateResponse_ = res.data[0]['smart_links'];
            this.anchorList_ = anchorList;
            return this.mapLinks_();
          });

      return new TwoStepsResponse(syncMappedLinks, asyncMappedLinks);
    } else { // If we didn't need to make an API call return the synchronous response
      this.anchorList_ = anchorList;
      return new TwoStepsResponse(syncMappedLinks);
    }
  }

  /**
   * Build the payload for the Linkmate API call and POST.
   * @param {!Array<!HTMLElement>} anchorList
   * @private
   * @return {?Promise}
   */
  postToLinkmate_(anchorList) {
    const linksPayload = this.buildLinksPayload_(anchorList);
    const editPayload = this.getEditInfo_();

    const payload = {
      'article': editPayload,
      'links': linksPayload,
    };

    const fetchUrl = ENDPOINTS.LINKMATE_ENDPOINT.replace(
        '.pub_id.', this.publisherID_
    );
    const postOptions = {
      method: 'POST',
      ampCors: false,
      headers: {'Content-Type': 'application/json'},
      body: payload,
    };

    return this.xhr_.fetchJson(fetchUrl, postOptions)
        .then(res => res.json());
  }

  /**
   * Build the links portion for Linkmate payload. We need to check each link
   * if it has #donotlink to comply with business rules.
   * @param {!Array<!HTMLElement>} anchorList
   * @return {!Array<Object>}
   * @private
   */
  buildLinksPayload_(anchorList) {
    // raw links needs to be stored as a global somewhere
    // for later association with the response
    const postLinks = [];
    anchorList.forEach(anchor => {
      const link = anchor[this.linkAttribute_];
      if (!/#donotlink$/.test(link)) {
        const exclusive = this.requestExclusiveLinks_ || /#locklink$/.test(link);
        const linkObj = {
          'raw_url': link,
          'exclusive_match_requested': exclusive,
        };

        postLinks.push(linkObj);
      }
    });

    return postLinks;
  }

  /**
   * This is just article information used in the edit part of Linkmate payload.
   * @return {!Object}
   * @private
   */
  getEditInfo_() {
    return {
      'name': this.rootNode_.title || null,
      'url': this.ampDoc_.getUrl(),
    };
  }

  /**
   * The API response returns unique links. Map those unique links to as many
   * urls in the anchorList as possible. Set the replacement url as a shop-link.
   * @return {!Array<JsonObject>}
   * @public
   */
  mapLinks_() {
    const mappedLinks = this.linkmateResponse_.map(smartLink => {
      return Array.prototype.slice.call(this.anchorList_)
          .map(anchor => {
            return {
              anchor,
              replacementUrl: anchor[this.linkAttribute_] === smartLink.url ?
                `https://shop-links.co/${smartLink['auction_id']}/?amp=true` : null,
            };
          });
    });

    return mappedLinks.flat();
  }
}
